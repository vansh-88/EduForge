import mongoose from 'mongoose';
import crypto from 'crypto';
import { Lesson, OutboxEvent, IdempotencyKey } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';


export async function requestLessonGeneration({ userId, courseId, lessonId, idempotencyKey, requestHash }) {
  
  // 1. Fast Path: Check if this idempotency key was already used successfully
  const existing = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    return { isCached: true, statusCode: existing.statusCode, data: existing.response };
  }

  // 2. Load + authorize (before opening a transaction)
  const lesson = await Lesson.findById(lessonId).populate({
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

  // 3. Short-circuit on terminal/in-flight status
  if (lesson.status === 'READY') {
    return {
      isCached: false,
      statusCode: 200,
      data: { success: true, message: 'Lesson already generated', lessonId, status: 'READY' }
    };
  }

  if (lesson.status === 'GENERATING' || lesson.status === 'PROCESSING') {
    return {
      isCached: false,
      statusCode: 202,
      data: { success: true, message: 'Lesson generation already in progress', lessonId, status: 'GENERATING' }
    };
  }

  // 4. Transactional CAS transition (for PENDING or FAILED)
  const session = await mongoose.startSession();
  let responseBody;
  let transitioned = true;

  try {
    await session.withTransaction(async () => {
      const generationId = crypto.randomUUID();

      // Compare-And-Swap (CAS) update
      const updated = await Lesson.findOneAndUpdate(
        { _id: lessonId, status: { $in: ['PENDING', 'FAILED'] } },
        { 
          $set: { status: 'GENERATING', lastError: null, startedAt: new Date() }, 
          $inc: { attempts: 1 } 
        },
        { session, returnDocument: 'after' }
      );

      // If the document wasn't updated, a concurrent request changed the status
      if (!updated) {
        transitioned = false;
        return;
      }

      // Create the Outbox Event
      const eventId = `lesson-generation-${lessonId}-${generationId}`;
      
      await OutboxEvent.create(
        [
          {
            eventId,
            type: 'LESSON_GENERATION_REQUESTED',
            aggregateType: 'Lesson',
            aggregateId: updated._id,
            payload: {
              lessonId: lessonId.toString(),
              courseId,
              userId,
              generationId,
            },
            status: 'PENDING',
          },
        ],
        { session }
      );

      // Save the Idempotency Key record to lock this request
      responseBody = {
        success: true,
        message: 'Lesson generation started',
        lessonId,
        status: 'GENERATING',
      };

      await IdempotencyKey.create(
        [
          {
            userId,
            key: idempotencyKey,
            requestHash,
            resourceType: 'LESSON_GENERATION',
            resourceId: updated._id,
            statusCode: 202,
            response: responseBody,
          },
        ],
        { session }
      );
    });

    // 5. Handle the lost-race case (status changed between the read and the transaction)
    if (!transitioned) {
      const currentLesson = await Lesson.findById(lessonId);
      
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
        data: { success: true, message: 'Lesson generation already in progress', lessonId, status: 'GENERATING' }
      };
    }

    return { isCached: false, statusCode: 202, data: responseBody };

  } catch (error) {
    // 6. Handle Race Condition: Two identical requests hit the DB at the exact same millisecond
    if (error?.code === 11000 && error?.keyPattern?.userId && error?.keyPattern?.key) {
      const raceWinner = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

      if (raceWinner && raceWinner.requestHash === requestHash) {
        return { isCached: true, statusCode: raceWinner.statusCode, data: raceWinner.response };
      }
      
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    
    // Bubble up any other unexpected DB errors
    throw error;
  } finally {
    await session.endSession();
  }
}