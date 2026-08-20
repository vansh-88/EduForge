import mongoose from 'mongoose';
import { Course, OutboxEvent, IdempotencyKey } from '../../models/index.js';

/**
 * Executes the atomic transaction to initialise new course generation.
 * Handles idempotency safely, including concurrent race conditions.
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.topic
 * @param {string} params.idempotencyKey
 * @param {string} params.requestHash
 * @returns {Promise<{ isCached: boolean, statusCode: number, data: Object }>}
 */

export async function newCourseGeneration({ userId, topic, idempotencyKey, requestHash }) {
  
  // 1. Fast Path: Check if this idempotency key was already used successfully
  const existing = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      const error = new Error('Idempotency-Key was already used with a different request payload');
      error.message = 'IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return { isCached: true, statusCode: existing.statusCode, data: existing.response };
  }

  // 2. Start the atomic transaction
  const session = await mongoose.startSession();
  let responseBody;

  try {
    await session.withTransaction(async () => {
      // 3. Create the placeholder Course
      const [course] = await Course.create(
        [
          {
            query: topic,
            creator: userId,
            status: 'GENERATING',
            modules: [],
          },
        ],
        { session }
      );

      // 4. Create the Outbox Event (This replaces direct worker/queue calls)
      const eventId = `course-generation:${course._id}`;
      
      await OutboxEvent.create(
        [
          {
            eventId,
            type: 'COURSE_GENERATION_REQUESTED',
            aggregateType: 'Course',
            aggregateId: course._id,
            payload: {
              courseId: course._id.toString(),
              userId,
              topic,
            },
            status: 'PENDING',
          },
        ],
        { session }
      );

      // 5. Save the Idempotency Key record to lock this request
      responseBody = {
        success: true,
        message: 'Course generation started',
        courseId: course._id.toString(),
        status: 'GENERATING',
      };

      await IdempotencyKey.create(
        [
          {
            userId,
            key: idempotencyKey,
            requestHash,
            resourceType: 'COURSE_GENERATION',
            resourceId: course._id,
            statusCode: 202,
            response: responseBody,
          },
        ],
        { session }
      );
    });

    return { isCached: false, statusCode: 202, data: responseBody };

  } catch (error) {
    // 6. Handle Race Condition: Two identical requests hit the DB at the exact same millisecond
    if (error?.code === 11000 && error?.keyPattern?.userId && error?.keyPattern?.key) {
      const raceWinner = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

      if (raceWinner && raceWinner.requestHash === requestHash) {
        return { isCached: true, statusCode: raceWinner.statusCode, data: raceWinner.response };
      }
      
      const conflictError = new Error('Idempotency-Key was already used with a different request payload');
      conflictError.message = 'IDEMPOTENCY_CONFLICT';
      throw conflictError;
    }
    
    // Bubble up any other unexpected DB errors
    throw error;
  } finally {
    await session.endSession();
  }
}