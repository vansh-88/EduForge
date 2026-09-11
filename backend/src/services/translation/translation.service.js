import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { LessonTranslation, OutboxEvent, IdempotencyKey } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { QUEUE_ATTEMPTS } from '../../config/env.config.js';
import { hashLessonContent } from '../../utils/contentHash.js';
import { publishTranslationEvent } from '../realtime/generationEvents.js';
import { loadAuthorizedLesson } from '../lesson/lesson.service.js';
import { toTranslationDTO } from '../../serializers/lesson.serializer.js';

const IN_FLIGHT = ['GENERATING', 'PROCESSING', 'RETRYING'];

/**
 * The CAS + outbox core, mirroring ensureLessonGeneration.
 *
 * There is exactly one row per (lesson, language), so this is a claim-or-create
 * rather than a plain insert: a regeneration after the source content changed
 * reuses the existing row. The CAS filter is what makes repeated clicks safe — a
 * row already GENERATING or PROCESSING for the hash we want matches nothing, so
 * no second job is created.
 *
 * Deliberately NOT `upsert: true` on the CAS filter. An upsert that fails to
 * match an existing row attempts an insert, which trips the unique index and
 * aborts the whole transaction — turning "someone else is already translating
 * this", a perfectly ordinary outcome, into an error path. Claim first, then
 * insert only when there was nothing to claim.
 */
async function ensureTranslationGeneration({ lesson, courseId, userId, language, sourceContentHash, idempotency = null }) {
  const lessonId = lesson._id;
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const generationId = crypto.randomUUID();

      const claimFields = {
        course: courseId,
        sourceContentHash,
        status: 'GENERATING',
        stage: 'queued',
        progress: 0,
        attempts: 0,
        maxAttempts: QUEUE_ATTEMPTS,
        generationId,
        lastError: null,
        completedAt: null,
        // Content from a previous cycle described different source text. Leaving
        // it would let a reader toggle to a translation of a lesson that no
        // longer exists while this job is still running.
        content: [],
      };

      // Claim an existing row only if there is nothing useful on it. A stale row
      // (any status, wrong hash) is fair game — its content no longer describes
      // the lesson. A current row that is READY or in flight is not.
      let claimed = await LessonTranslation.findOneAndUpdate(
        {
          lesson: lessonId,
          language,
          $or: [
            { sourceContentHash: { $ne: sourceContentHash } },
            { status: { $in: ['PENDING', 'FAILED'] } },
          ],
        },
        { $set: claimFields },
        { session, returnDocument: 'after' }
      );

      if (!claimed) {
        // Either no row exists yet, or one exists that we must not disturb.
        const current = await LessonTranslation.findOne({ lesson: lessonId, language }).session(session);

        if (current) {
          result = { transitioned: false };
          return;
        }

        // First ever request for this lesson+language. A concurrent request can
        // still win the race here; the unique index makes that a 11000 the
        // caller resolves by reporting the winner's state.
        const [created] = await LessonTranslation.create(
          [{ lesson: lessonId, language, ...claimFields }],
          { session }
        );
        claimed = created;
      }

      await OutboxEvent.create(
        [{
          eventId: `lesson-translation-${lessonId}-${language}-${generationId}`,
          type: 'LESSON_TRANSLATION_REQUESTED',
          aggregateType: 'LessonTranslation',
          aggregateId: claimed._id,
          payload: {
            translationId: String(claimed._id),
            lessonId: String(lessonId),
            courseId: String(courseId),
            userId: String(userId),
            language,
            sourceContentHash,
            generationId,
          },
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
            resourceType: 'LESSON_TRANSLATION',
            resourceId: claimed._id,
            statusCode: 202,
            response: idempotency.response,
          }],
          { session }
        );
      }

      result = { transitioned: true, translation: claimed, generationId };
    });

    // Only after the transaction commits — the same rule the lesson path follows.
    if (result?.transitioned) {
      await publishTranslationEvent(lessonId, language, {
        type: 'lesson_translation_queued',
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

/** Shapes the 200/202 bodies so every return path below agrees on them. */
function statusResponse(translation, { lessonId, language }) {
  if (translation?.status === 'READY') {
    return {
      statusCode: 200,
      data: {
        success: true,
        message: 'Translation already available',
        ...toTranslationDTO(translation, { lessonId }),
      },
    };
  }

  return {
    statusCode: 202,
    data: {
      success: true,
      message: 'Translation already in progress',
      lessonId: String(lessonId),
      language,
      status: translation?.status ?? 'GENERATING',
    },
  };
}

/**
 * Start (or short-circuit) a lesson translation.
 *
 * Idempotent three times over, because a reader clicking a button five times must
 * not spend five AI calls: the Idempotency-Key replay cache, the cached-artifact
 * check below, and the CAS claim inside the transaction.
 */
export async function requestLessonTranslation({ userId, courseId, moduleId, lessonId, language, idempotencyKey, requestHash }) {
  // 1. Fast path: this exact request already succeeded.
  const existingKey = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

  if (existingKey) {
    if (existingKey.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    return { isCached: true, statusCode: existingKey.statusCode, data: existingKey.response };
  }

  // 2. Load + authorize before opening a transaction. 404s if not the caller's.
  const lesson = await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });

  // 3. There is nothing to translate until the lesson itself exists.
  if (lesson.status !== 'READY') {
    throw ApiError.conflict('Lesson content is not available yet', { code: 'LESSON_NOT_READY' });
  }

  const sourceContentHash = hashLessonContent(lesson.content);

  // 4. Cache check. A row whose hash matches the live lesson is usable as-is;
  // one whose hash differs was derived from content that has since changed and is
  // ignored here so step 5 regenerates it.
  const existing = await LessonTranslation.findOne({ lesson: lessonId, language });

  if (existing && existing.sourceContentHash === sourceContentHash) {
    if (existing.status === 'READY') {
      return { isCached: false, ...statusResponse(existing, { lessonId, language }) };
    }
    if (IN_FLIGHT.includes(existing.status)) {
      return { isCached: false, ...statusResponse(existing, { lessonId, language }) };
    }
  }

  // 5. Claim + enqueue + record the key, all committed together.
  const responseBody = {
    success: true,
    message: 'Translation started',
    lessonId: String(lessonId),
    language,
    status: 'GENERATING',
  };

  let transitioned;
  try {
    ({ transitioned } = await ensureTranslationGeneration({
      lesson,
      courseId,
      userId,
      language,
      sourceContentHash,
      idempotency: { key: idempotencyKey, requestHash, response: responseBody },
    }));
  } catch (error) {
    // Another request claimed this idempotency key first.
    if (error?.code === 11000 && error?.keyPattern?.userId && error?.keyPattern?.key) {
      const raceWinner = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

      if (raceWinner && raceWinner.requestHash === requestHash) {
        return { isCached: true, statusCode: raceWinner.statusCode, data: raceWinner.response };
      }

      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }

    // Two concurrent first-requests raced the upsert; the loser reports the
    // winner's state rather than failing a request that got what it wanted.
    if (error?.code === 11000) {
      const winner = await LessonTranslation.findOne({ lesson: lessonId, language });
      if (winner) return { isCached: false, ...statusResponse(winner, { lessonId, language }) };
    }

    throw error;
  }

  if (!transitioned) {
    // The CAS matched nothing, so something usable arrived between step 4 and here.
    const current = await LessonTranslation.findOne({ lesson: lessonId, language });
    return { isCached: false, ...statusResponse(current, { lessonId, language }) };
  }

  return { isCached: false, statusCode: 202, data: responseBody };
}

/**
 * Read one translation.
 *
 * Reports the live staleness verdict rather than trusting the stored row: a
 * translation whose hash no longer matches its lesson is returned as STALE with
 * no content, so a client cannot render a translation of content that has since
 * been regenerated.
 */
export async function getLessonTranslation({ userId, courseId, moduleId, lessonId, language }) {
  const lesson = await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });

  const translation = await LessonTranslation.findOne({ lesson: lessonId, language }).lean();

  if (!translation) {
    return { lessonId: String(lessonId), language, status: 'NOT_REQUESTED', content: null };
  }

  const sourceContentHash = hashLessonContent(lesson.content);

  if (translation.sourceContentHash !== sourceContentHash) {
    return { lessonId: String(lessonId), language, status: 'STALE', content: null };
  }

  return toTranslationDTO(translation, { lessonId });
}
