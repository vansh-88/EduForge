import mongoose from 'mongoose';
import { Course, OutboxEvent, IdempotencyKey } from '../../models/index.js';
import crypto from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';

export async function newCourseGeneration({ userId, topic, idempotencyKey, requestHash }) {
  
  // 1. Fast Path: Check if this idempotency key was already used successfully
  const existing = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
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
            startedAt: new Date(),
          },
        ],
        { session }
      );

      // 4. Create the Outbox Event (This replaces direct worker/queue calls)
      const generationId = crypto.randomUUID();
      const eventId = `course-generation-${course._id}-${generationId}`;
      
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
              generationId,
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
      
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    
    // Bubble up any other unexpected DB errors
    throw error;
  } finally {
    await session.endSession();
  }
}


export async function retryCourseGeneration({ userId, courseId, idempotencyKey, requestHash }) {

  // 1. Fast Path: idempotency
  const existing = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    return { isCached: true, statusCode: existing.statusCode, data: existing.response };
  }

  // 2. Load + authorize
  const course = await Course.findOne({ _id: courseId, creator: userId });

  if (!course) {
    throw ApiError.notFound('Course not found', { code: 'NOT_FOUND' });
  }

  // 3. Short-circuit on terminal/in-flight status
  if (course.status === 'READY') {
    return {
      isCached: false,
      statusCode: 200,
      data: { success: true, message: 'Course already generated', courseId, status: 'READY' },
    };
  }

  if (course.status === 'GENERATING' || course.status === 'PROCESSING') {
    return {
      isCached: false,
      statusCode: 202,
      data: { success: true, message: 'Course generation already in progress', courseId, status: 'GENERATING' },
    };
  }

  // 4. Transactional CAS transition (course.status must be FAILED)
  const session = await mongoose.startSession();
  let responseBody;
  let transitioned = true;

  try {
    await session.withTransaction(async () => {
      const generationId = crypto.randomUUID();

      const updated = await Course.findOneAndUpdate(
        { _id: courseId, status: 'FAILED' },
        {
          $set: { status: 'GENERATING', lastError: null, startedAt: new Date(), completedAt: null },
          $inc: { attempts: 1 },
        },
        { session, returnDocument: 'after' }
      );

      if (!updated) {
        transitioned = false;
        return;
      }

      const eventId = `course-generation-${courseId}-${generationId}`;

      await OutboxEvent.create([{
        eventId,
        type: 'COURSE_GENERATION_REQUESTED',
        aggregateType: 'Course',
        aggregateId: updated._id,
        payload: {
          courseId: courseId.toString(),
          userId,
          topic: updated.query,
          generationId,
        },
        status: 'PENDING',
      }], { session });

      responseBody = { success: true, message: 'Course generation retry started', courseId, status: 'GENERATING' };

      await IdempotencyKey.create([{
        userId, key: idempotencyKey, requestHash,
        resourceType: 'COURSE_RETRY', resourceId: updated._id,
        statusCode: 202, response: responseBody,
      }], { session });
    });

    if (!transitioned) {
      const current = await Course.findById(courseId);
      if (current.status === 'READY') {
        return { isCached: false, statusCode: 200, data: { success: true, message: 'Course already generated', courseId, status: 'READY' } };
      }
      return { isCached: false, statusCode: 202, data: { success: true, message: 'Course generation already in progress', courseId, status: 'GENERATING' } };
    }

    return { isCached: false, statusCode: 202, data: responseBody };

  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.userId && error?.keyPattern?.key) {
      const raceWinner = await IdempotencyKey.findOne({ userId, key: idempotencyKey });
      if (raceWinner && raceWinner.requestHash === requestHash) {
        return { isCached: true, statusCode: raceWinner.statusCode, data: raceWinner.response };
      }
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    throw error;
  } finally {
    await session.endSession();
  }
}