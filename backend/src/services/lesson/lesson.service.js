import mongoose from 'mongoose';
import crypto from 'crypto';
import { Lesson, Module, OutboxEvent, IdempotencyKey } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { QUEUE_ATTEMPTS } from '../../config/env.config.js';
import { publishLessonEvent } from '../realtime/lessonEvents.publisher.js';




//Loads a lesson and proves the caller owns it, validating the whole course -> module -> lesson hierarchy. 
export async function loadAuthorizedLesson({ userId, courseId, moduleId, lessonId }) {
  const filter = { _id: lessonId };
  if (moduleId) filter.module = moduleId;

  const lesson = await Lesson.findOne(filter).populate({
    path: 'module',
    populate: { path: 'course' },
  });

  if (
    !lesson ||
    !lesson.module ||
    !lesson.module.course ||
    lesson.module.course._id.toString() !== courseId ||
    !lesson.module.course.creator.equals(userId)
  ) {
    throw ApiError.notFound('Lesson not found', { code: 'NOT_FOUND' });
  }

  return lesson;
}



//The shared CAS + outbox core. Idempotency is optional because the lookahead has no client request to cache.
export async function ensureLessonGeneration(lessonId, { courseId, userId, source = 'user', idempotency = null }) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const generationId = crypto.randomUUID();

      const updated = await Lesson.findOneAndUpdate(
        { _id: lessonId, status: { $in: ['PENDING', 'FAILED'] } },
        {
          $set: {
            status: 'GENERATING',
            lastError: null,
            startedAt: new Date(),
            attempts: 0,
            maxAttempts: QUEUE_ATTEMPTS,
            stage: 'queued',
            progress: 0,
          },
        },
        { session, returnDocument: 'after' }
      );

      if (!updated) {
        result = { transitioned: false, lesson: null };
        return;
      }

      const eventId = `lesson-generation-${lessonId}-${generationId}`;
      await OutboxEvent.create(
        [{
          eventId,
          type: 'LESSON_GENERATION_REQUESTED',
          aggregateType: 'Lesson',
          aggregateId: updated._id,
          payload: { lessonId: lessonId.toString(), courseId, userId, generationId, source },
          status: 'PENDING',
        }],
        { session }
      );

      if (idempotency) {
        await IdempotencyKey.create(
          [{
            userId,
            key: idempotency.key,
            requestHash: idempotency.requestHash,
            resourceType: 'LESSON_GENERATION',
            resourceId: updated._id,
            statusCode: 202,
            response: idempotency.response,
          }],
          { session }
        );
      }

      result = { transitioned: true, lesson: updated };
    });

    // Published only after the transaction commits, sse event to frontend for generation queued.
    if (result?.transitioned) {
      await publishLessonEvent(lessonId, {
        type: 'lesson_generation_queued',
        status: 'GENERATING',
        stage: 'queued',
        progress: 0,
        attempt: 0,
        maxAttempts: QUEUE_ATTEMPTS,
      });
    }

    return result;
  } finally {
    await session.endSession();
  }
}



export async function requestLessonGeneration({ userId, courseId, moduleId, lessonId, idempotencyKey, requestHash }) {


  // 1. Fast Path: Check if this idempotency key was already used successfully
  const existing = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    return { isCached: true, statusCode: existing.statusCode, data: existing.response };
  }


  // 2. Load + authorize (before opening a transaction)
  const lesson = await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });


  // 3. Short-circuit on terminal/in-flight status
  if (lesson.status === 'READY') {
    return {
      isCached: false,
      statusCode: 200,
      data: { success: true, message: 'Lesson already generated', lessonId, status: 'READY' }
    };
  }

  if (['GENERATING', 'PROCESSING', 'RETRYING'].includes(lesson.status)) {
    return {
      isCached: false,
      statusCode: 202,
      data: { success: true, message: 'Lesson generation already in progress', lessonId, status: lesson.status }
    };
  }


  // 4. Delegate the CAS + outbox + idempotency writes to the shared core, which commits all three atomically.
  const responseBody = {
    success: true,
    message: 'Lesson generation started',
    lessonId,
    status: 'GENERATING',
  };

  let transitioned;
  try {
    ({ transitioned } = await ensureLessonGeneration(lessonId, {
      courseId,
      userId,
      source: 'user',
      idempotency: { key: idempotencyKey, requestHash, response: responseBody },
    }));
  } 
  catch (error) {
    // Another request claimed this key first.
    if (error?.code === 11000 && error?.keyPattern?.userId && error?.keyPattern?.key) {
      const raceWinner = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

      if (raceWinner && raceWinner.requestHash === requestHash) {
        return { isCached: true, statusCode: raceWinner.statusCode, data: raceWinner.response };
      }

      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }

    throw error;
  }

  if (!transitioned) {
    const currentLesson = await Lesson.findById(lessonId);

    // Deleted between the authorize read and the transaction.
    if (!currentLesson) {
      throw ApiError.notFound('Lesson not found', { code: 'NOT_FOUND' });
    }

    if (currentLesson.status === 'READY') {
      return {
        isCached: false,
        statusCode: 200,
        data: { success: true, message: 'Lesson already generated', lessonId, status: 'READY' }
      };
    }

    return {
      isCached: false,
      statusCode: 202,
      data: { success: true, message: 'Lesson generation already in progress', lessonId, status: currentLesson.status }
    };
  }

  // The idempotency record was committed inside the transaction above.
  return { isCached: false, statusCode: 202, data: responseBody };

}



//One-lesson lookahead: make sure the lesson AFTER this one exists.
// Called from two places, which together give a sliding window without a cascade:
// - the worker, when a user-requested generation completes (head start while the user reads the lesson they just waited for)
// - getLesson, when a READY lesson is served (the user moved forward, so pull the window forward with them)
export async function ensureNextLessonGenerated(lessonId) {
  const lesson = await Lesson.findById(lessonId).populate({ path: 'module', populate: { path: 'course' } });
  if (!lesson || !lesson.module || !lesson.module.course) return;

  const { module } = lesson;
  const { course } = module;

  let nextLesson = await Lesson.findOne({ module: module._id, order: { $gt: lesson.order } }).sort({ order: 1 });

  if (!nextLesson) {
    const nextModule = await Module.findOne({ course: course._id, order: { $gt: module.order } }).sort({ order: 1 });
    if (nextModule) {
      nextLesson = await Lesson.findOne({ module: nextModule._id }).sort({ order: 1 });
    }
  }

  if (!nextLesson || nextLesson.status !== 'PENDING') return;

  // Marked as lookahead so the worker does NOT chain another lookahead off it — otherwise one request would generate the entire remaining course.
  await ensureLessonGeneration(nextLesson._id, {
    courseId: course._id.toString(),
    userId: course.creator.toString(),
    source: 'lookahead',
  });
}