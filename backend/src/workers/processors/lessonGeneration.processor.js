import mongoose from 'mongoose';
import { Lesson, Module, Course } from '../../models/index.js';
import { lessonOutputSchema, generateLessonRequestSchema } from '../../schemas/index.js';
import { generateStructured } from '../../services/ai/aiService.js';
import { buildLessonPrompt } from '../../services/ai/prompts/lessonPrompt.js';
import { buildLessonContext } from '../../services/ai/context/lessonContext.js';
import crypto from 'node:crypto';
import { publishLessonEvent } from '../../services/realtime/lessonEvents.publisher.js';
import { ensureNextLessonGenerated } from '../../services/lesson/lesson.service.js';


async function setStageAndPublish(lessonId, state, { stage, progress, attempt, maxAttempts }) {
  // Track locally too, so the retry/failure events can report where generation got
  // to instead of blanking the client's progress bar.
  state.stage = stage;
  state.progress = progress;

  await Lesson.updateOne({ _id: lessonId }, { $set: { stage, progress } });
  await publishLessonEvent(lessonId, {
    type: 'lesson_generation_progress',
    status: 'generating',
    stage,
    progress,
    attempt,
    maxAttempts,
  });
}


function withQuestionIds(content) {
  return content.map((block) =>
    block.type === 'mcq' ? { ...block, id: crypto.randomUUID() } : block
  );
}

async function persistGeneratedLesson(session, { lessonId, generationId, aiResponse }) {
  const currentLesson = await Lesson.findOne({ _id: lessonId, status: 'PROCESSING', generationId }).session(session);

  if (!currentLesson) {
    // Not our PROCESSING claim any more (already READY, or a newer cycle took over).
    // Report that nothing was written so the caller does not announce a completion.
    return false;
  }

  currentLesson.content = withQuestionIds(aiResponse.content);
  currentLesson.completedAt = new Date();
  currentLesson.lastError = null;
  currentLesson.stage = 'completed';
  currentLesson.progress = 100;
  currentLesson.status = 'READY';
  await currentLesson.save({ session });

  return true;
}

export async function runAiLessonGeneration({ lessonId, courseId, userId, generationId, source = 'user', job }) {
  generateLessonRequestSchema.parse({ lessonId }); //optional to check, just an extra safety check, no need tho.

  const currentAttempt = (job?.attemptsMade || 0) + 1;
  const maxAttempts = job?.opts?.attempts;

  // 1. ATOMIC CLAIM — GENERATING (first attempt) or RETRYING (a prior attempt failed).
  // A PROCESSING doc stamped with OUR generationId is this job's own stranded claim from a killed worker: reclaim it, otherwise the lesson stays PROCESSING forever and the user can never retry it. Another cycle's PROCESSING still bounces off.
  const claimedLesson = await Lesson.findOneAndUpdate(
    {
      _id: lessonId,
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
        stage: 'preparing_context',
        progress: 10,
      },
    },
    { returnDocument: 'after' }
  );

  if (!claimedLesson) {
    console.log(`[LessonWorker] Job skipped: Lesson ${lessonId} already claimed, completed, or missing (generation=${generationId}).`);
    return;
  }

  const state = { stage: 'preparing_context', progress: 10 };

  await publishLessonEvent(lessonId, {
    type: currentAttempt === 1 ? 'lesson_generation_started' : 'lesson_generation_progress',
    status: 'generating',
    stage: state.stage,
    progress: state.progress,
    attempt: currentAttempt,
    maxAttempts,
  });

  try {
    const context = await buildLessonContext(courseId, lessonId, userId);

    await setStageAndPublish(lessonId, state, { stage: 'generating_content', progress: 40, attempt: currentAttempt, maxAttempts });

    const prompt = buildLessonPrompt({ course: context.courseDoc, module: context.moduleDoc, lesson: context.lessonDoc });
    const aiResponse = await generateStructured(prompt, lessonOutputSchema);

    await setStageAndPublish(lessonId, state, { stage: 'saving', progress: 80, attempt: currentAttempt, maxAttempts });

    let persisted = false;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        persisted = await persistGeneratedLesson(session, { lessonId, generationId, aiResponse });
      });
    } finally {
      await session.endSession();
    }

    // Nothing was written (a newer cycle owns the lesson) — announcing completion
    // here would tell the client to fetch content this job never produced.
    if (!persisted) {
      console.log(`[LessonWorker] Nothing persisted for lesson ${lessonId} (generation=${generationId}) — superseded.`);
      return { lessonId, status: 'SKIPPED' };
    }

    await publishLessonEvent(lessonId, {
      type: 'lesson_generation_completed',
      status: 'ready',
      stage: 'completed',
      progress: 100,
      attempt: currentAttempt,
      maxAttempts,
    });

    // Only a user-requested generation looks ahead. Chaining off a lookahead would
    // walk the whole course and defeat lazy generation.
    if (source === 'user') {
      await ensureNextLessonGenerated(lessonId).catch((err) => {
        console.error(`[LessonWorker] Lookahead failed for lesson ${lessonId}:`, err.message);
      });
    }

    return { lessonId, status: 'READY' };

  } catch (error) {
    const isFinalAttempt = currentAttempt >= maxAttempts;
    const lastError = `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}`;

    // Guarded by our own claim: without this, a throw that happens AFTER the lesson
    // was already committed READY would demote it and trigger a regeneration that
    // overwrites good content.
    await Lesson.updateOne(
      { _id: lessonId, status: 'PROCESSING', generationId },
      {
        $set: {
          status: isFinalAttempt ? 'FAILED' : 'RETRYING',
          lastError,
          completedAt: null,
        },
      }
    );

    await publishLessonEvent(lessonId, {
      type: isFinalAttempt ? 'lesson_generation_failed' : 'lesson_generation_retrying',
      status: isFinalAttempt ? 'failed' : 'retrying',
      stage: state.stage,
      progress: state.progress,
      attempt: currentAttempt,
      maxAttempts,
      lastError,
    });

    throw error;
  }
}