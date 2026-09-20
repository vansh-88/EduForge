import mongoose from 'mongoose';
import { Lesson, Module, Course, VideoSlot, OutboxEvent } from '../../models/index.js';
import { normalizeQuery, deriveFallbackQuery } from '../../services/video/query.js';
import { VIDEO_JOB_ATTEMPTS } from '../../config/env.config.js';
import { lessonOutputSchema, generateLessonRequestSchema } from '../../schemas/index.js';
import { generateStructured } from '../../services/ai/aiService.js';
import { buildLessonPrompt } from '../../services/ai/prompts/lessonPrompt.js';
import { buildLessonContext } from '../../services/ai/context/lessonContext.js';
import crypto from 'node:crypto';
import { publishGenerationEvent, publishEnrichmentCompleted } from '../../services/realtime/generationEvents.js';
import { ensureNextLessonGenerated } from '../../services/lesson/lesson.service.js';


async function setStageAndPublish(lessonId, state, { stage, progress, attempt, maxAttempts }) {
  // Track locally too, so the retry/failure events can report where generation got
  // to instead of blanking the client's progress bar.
  state.stage = stage;
  state.progress = progress;

  await Lesson.updateOne({ _id: lessonId }, { $set: { stage, progress } });
  await publishGenerationEvent('lesson', lessonId, {
    type: 'lesson_generation_progress',
    status: 'generating',
    stage,
    progress,
    attempt,
    maxAttempts,
  });
}


/**
 * Stamps stable ids onto the blocks that need to be addressed later: MCQs, so an
 * answer can be recorded against a question, and videos, so a resolved video can
 * be matched back to its slot. Both are generated here rather than by the model —
 * the model cannot be trusted to produce unique ids, and it costs tokens to ask.
 */
function withBlockIds(content) {
  return content.map((block) => {
    if (block.type === 'mcq') return { ...block, id: crypto.randomUUID() };
    if (block.type === 'video') return { ...block, slotId: crypto.randomUUID() };
    return block;
  });
}

/** VideoSlot rows + their outbox events, for every video block in the content. */
function buildVideoSlots(content, { lessonId, courseId, generationId }) {
  const slots = [];
  const events = [];

  content.forEach((block, index) => {
    if (block.type !== 'video') return;

    const primaryQuery = normalizeQuery(block.query);
    if (!primaryQuery) return;

    slots.push({
      lesson: lessonId,
      course: courseId,
      slotId: block.slotId,
      order: index,
      status: 'PENDING',
      search: {
        primaryQuery,
        // Derived, never model-generated — see services/video/query.js.
        fallbackQuery: deriveFallbackQuery(primaryQuery),
        language: 'en',
        caption: block.caption ?? null,
      },
      maxAttempts: VIDEO_JOB_ATTEMPTS,
    });

    events.push({
      eventId: `video-slot-${block.slotId}-${generationId}`,
      type: 'VIDEO_SLOT_RESOLUTION_REQUESTED',
      aggregateType: 'VideoSlot',
      // No VideoSlot _id exists until insertMany runs, and the slot is uniquely
      // addressed by (lesson, slotId) anyway.
      aggregateId: lessonId,
      payload: { lessonId: String(lessonId), courseId: String(courseId), slotId: block.slotId },
    });
  });

  return { slots, events };
}

async function persistGeneratedLesson(session, { lessonId, courseId, generationId, aiResponse }) {
  const currentLesson = await Lesson.findOne({ _id: lessonId, status: 'PROCESSING', generationId }).session(session);

  if (!currentLesson) {
    // Not our PROCESSING claim any more (already READY, or a newer cycle took over).
    // Report that nothing was written so the caller does not announce a completion.
    return { persisted: false, slotCount: 0 };
  }

  const content = withBlockIds(aiResponse.content);

  currentLesson.content = content;
  currentLesson.completedAt = new Date();
  currentLesson.lastError = null;
  currentLesson.stage = 'completed';
  currentLesson.progress = 100;
  currentLesson.status = 'READY';
  await currentLesson.save({ session });

  // Request indexing in the same transaction that commits the content, exactly as
  // the video slot events below are: the tutor's knowledge base is asked for if
  // and only if the content it would describe was actually written.
  //
  // Asynchronous on purpose. Embedding a lesson is a provider call, and making
  // generation wait on it would hold a reader away from a lesson that is already
  // finished — for a feature they may never open. The reader starts reading; the
  // index catches up behind them.
  await OutboxEvent.create(
    [{
      eventId: crypto.randomUUID(),
      type: 'LESSON_INDEX_REQUESTED',
      aggregateType: 'Lesson',
      aggregateId: lessonId,
      payload: {
        lessonId: String(lessonId),
        courseId: String(courseId),
        source: 'lesson-generation',
      },
    }],
    { session }
  );

  const { slots, events } = buildVideoSlots(content, { lessonId, courseId, generationId });

  if (slots.length > 0) {
    // A regeneration replaces the content, so any slots from the previous cycle
    // point at blocks that no longer exist. Clearing them keeps the "unsettled
    // slot" count — which is what decides when the SSE stream may close — from
    // being held open forever by an orphan.
    await VideoSlot.deleteMany({ lesson: lessonId }).session(session);
    await VideoSlot.insertMany(slots, { session });

    // Same transaction as the lesson and the slots: the enrichment work is
    // requested if and only if the content that needs it was committed.
    await OutboxEvent.insertMany(events, { session });
  } else {
    await VideoSlot.deleteMany({ lesson: lessonId }).session(session);
  }

  return { persisted: true, slotCount: slots.length };
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

  await publishGenerationEvent('lesson', lessonId, {
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

    let result = { persisted: false, slotCount: 0 };
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        result = await persistGeneratedLesson(session, { lessonId, courseId, generationId, aiResponse });
      });
    } finally {
      await session.endSession();
    }

    // Nothing was written (a newer cycle owns the lesson) — announcing completion
    // here would tell the client to fetch content this job never produced.
    if (!result.persisted) {
      console.log(`[LessonWorker] Nothing persisted for lesson ${lessonId} (generation=${generationId}) — superseded.`);
      return { lessonId, status: 'SKIPPED' };
    }

    await publishGenerationEvent('lesson', lessonId, {
      type: 'lesson_generation_completed',
      status: 'ready',
      stage: 'completed',
      progress: 100,
      attempt: currentAttempt,
      maxAttempts,
    });

    // The lesson's SSE stream now stays open past 'completed' so video slots can
    // report in. With no slots to wait for, nothing else would ever close it —
    // so say so immediately.
    if (result.slotCount === 0) {
      await publishEnrichmentCompleted(lessonId);
    }

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

    await publishGenerationEvent('lesson', lessonId, {
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