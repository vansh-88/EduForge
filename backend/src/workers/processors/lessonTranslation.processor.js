import { UnrecoverableError } from 'bullmq';
import { Lesson, LessonTranslation } from '../../models/index.js';
import { ProviderQuotaError, toReaderMessage } from '../../services/ai/providerError.js';
import { translationOutputSchema } from '../../schemas/index.js';
import { generateStructured } from '../../services/ai/aiService.js';
import { buildHinglishPrompt } from '../../services/ai/prompts/hinglishPrompt.js';
import { publishTranslationEvent } from '../../services/realtime/generationEvents.js';
import { hashLessonContent } from '../../utils/contentHash.js';
import { TRANSLATION_BATCH_MAX_ITEMS, TRANSLATION_BATCH_MAX_CHARS } from '../../config/env.config.js';
import {
  extractTranslatableStrings,
  applyTranslations,
  assertTranslationCoverage,
  batchTranslatableStrings,
} from '../../services/translation/translatable.js';

async function setStageAndPublish(translationId, lessonId, language, state, { stage, progress, attempt, maxAttempts }) {
  // Tracked locally as well, so a retry or failure event can report where the job
  // got to instead of blanking the client's progress bar back to zero.
  state.stage = stage;
  state.progress = progress;

  await LessonTranslation.updateOne({ _id: translationId }, { $set: { stage, progress } });
  await publishTranslationEvent(lessonId, language, {
    type: 'lesson_translation_progress',
    status: 'generating',
    stage,
    progress,
    attempt,
    maxAttempts,
  });
}

/**
 * Translates every string in the lesson, one batch at a time.
 *
 * Batches run sequentially rather than in parallel: they share the same Gemini
 * quota as lesson generation, and a lesson's worth of concurrent calls from each
 * of several workers is the quickest way to rate-limit the feature everyone
 * actually uses. Progress is reported per batch, so a long lesson still moves.
 */
async function translateStrings(items, { courseTitle, lessonTitle, onBatchDone }) {
  const batches = batchTranslatableStrings(items, {
    maxItems: TRANSLATION_BATCH_MAX_ITEMS,
    maxChars: TRANSLATION_BATCH_MAX_CHARS,
  });

  const translations = new Map();

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];

    const prompt = buildHinglishPrompt({ courseTitle, lessonTitle, items: batch });
    const response = await generateStructured(prompt, translationOutputSchema);

    // Per batch, not at the end: a model that dropped keys in batch 1 should
    // fail before batches 2..n are paid for.
    assertTranslationCoverage(batch, response.items);

    for (const item of response.items) translations.set(item.key, item.text);

    await onBatchDone?.(i + 1, batches.length);
  }

  return translations;
}

export async function runLessonTranslation({ translationId, lessonId, language, generationId, sourceContentHash, job }) {
  const currentAttempt = (job?.attemptsMade || 0) + 1;
  const maxAttempts = job?.opts?.attempts;

  // 1. ATOMIC CLAIM — GENERATING (first attempt) or RETRYING (a prior one failed).
  // A PROCESSING row stamped with OUR generationId is this job's own stranded
  // claim from a killed worker: reclaim it, or the translation stays PROCESSING
  // forever and the reader can never retry. Another cycle's PROCESSING bounces off.
  const claimed = await LessonTranslation.findOneAndUpdate(
    {
      _id: translationId,
      $or: [
        { status: { $in: ['GENERATING', 'RETRYING'] } },
        { status: 'PROCESSING', generationId },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        generationId,
        attempts: currentAttempt,
        maxAttempts,
        stage: 'translating',
        progress: 10,
      },
    },
    { returnDocument: 'after' }
  );

  if (!claimed) {
    console.log(`[TranslationWorker] Job skipped: translation ${translationId} already claimed, completed, or missing (generation=${generationId}).`);
    return { translationId, status: 'SKIPPED' };
  }

  const state = { stage: 'translating', progress: 10 };

  await publishTranslationEvent(lessonId, language, {
    type: currentAttempt === 1 ? 'lesson_translation_started' : 'lesson_translation_progress',
    status: 'generating',
    stage: state.stage,
    progress: state.progress,
    attempt: currentAttempt,
    maxAttempts,
  });

  try {
    const lesson = await Lesson.findById(lessonId).populate({
      path: 'module',
      populate: { path: 'course' },
    });

    if (!lesson || lesson.status !== 'READY') {
      throw new Error(`Lesson ${lessonId} is not READY — nothing to translate`);
    }

    // The lesson may have been regenerated between the request and this job. Its
    // content no longer matches what the user asked to have translated, so
    // producing a translation of it would quietly answer a different question.
    const liveHash = hashLessonContent(lesson.content);
    if (liveHash !== sourceContentHash) {
      throw new Error('Lesson content changed after the translation was requested');
    }

    const items = extractTranslatableStrings(lesson.content);

    if (items.length === 0) {
      throw new Error(`Lesson ${lessonId} has no translatable text`);
    }

    const translations = await translateStrings(items, {
      courseTitle: lesson.module.course.title,
      lessonTitle: lesson.title,
      onBatchDone: async (done, total) => {
        // 10 → 80 across the batches, leaving the tail for persistence.
        const progress = 10 + Math.round((done / total) * 70);
        await setStageAndPublish(translationId, lessonId, language, state, {
          stage: 'translating',
          progress,
          attempt: currentAttempt,
          maxAttempts,
        });
      },
    });

    await setStageAndPublish(translationId, lessonId, language, state, {
      stage: 'saving',
      progress: 85,
      attempt: currentAttempt,
      maxAttempts,
    });

    const content = applyTranslations(lesson.content, translations);

    // Guarded by our own claim, and by the hash: a slow job must not overwrite a
    // newer cycle's committed translation, and must not publish a completion for
    // content it did not write.
    const persisted = await LessonTranslation.findOneAndUpdate(
      { _id: translationId, status: 'PROCESSING', generationId },
      {
        $set: {
          content,
          status: 'READY',
          stage: 'completed',
          progress: 100,
          lastError: null,
          completedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!persisted) {
      console.log(`[TranslationWorker] Nothing persisted for translation ${translationId} (generation=${generationId}) — superseded.`);
      return { translationId, status: 'SKIPPED' };
    }

    await publishTranslationEvent(lessonId, language, {
      type: 'lesson_translation_completed',
      status: 'ready',
      stage: 'completed',
      progress: 100,
      attempt: currentAttempt,
      maxAttempts,
    });

    return { translationId, status: 'READY' };

  } catch (error) {
    // See the TTS processor: a daily quota rejection is refused in milliseconds,
    // so retrying it burns the whole budget in seconds and reports the wrong
    // cause to the reader.
    const exhausted = error instanceof ProviderQuotaError && error.daily;

    const isFinalAttempt = exhausted || currentAttempt >= maxAttempts;
    const readerMessage = toReaderMessage(error);
    const lastError = readerMessage ?? `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}`;

    // Guarded by our own claim: without it, a throw occurring AFTER the row was
    // already committed READY would demote a good translation.
    await LessonTranslation.updateOne(
      { _id: translationId, status: 'PROCESSING', generationId },
      {
        $set: {
          status: isFinalAttempt ? 'FAILED' : 'RETRYING',
          lastError,
          completedAt: null,
        },
      }
    );

    await publishTranslationEvent(lessonId, language, {
      type: isFinalAttempt ? 'lesson_translation_failed' : 'lesson_translation_retrying',
      status: isFinalAttempt ? 'failed' : 'retrying',
      stage: state.stage,
      progress: state.progress,
      attempt: currentAttempt,
      maxAttempts,
      lastError,
    });

    if (exhausted) {
      console.error(`[TranslationWorker] 🚫 ${error.message} — not retrying.`);
      throw new UnrecoverableError(lastError);
    }

    throw error;
  }
}
