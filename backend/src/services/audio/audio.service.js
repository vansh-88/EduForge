import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { LessonAudio, LessonAudioSegment, OutboxEvent, IdempotencyKey } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { TTS_JOB_ATTEMPTS, TTS_VOICE, TTS_LANGUAGE } from '../../config/env.config.js';
import { hashLessonContent } from '../../utils/contentHash.js';
import { publishAudioEvent } from '../realtime/generationEvents.js';
import { loadAuthorizedLesson } from '../lesson/lesson.service.js';
import { toAudioDTO } from '../../serializers/lesson.serializer.js';

const IN_FLIGHT = ['GENERATING', 'PROCESSING', 'RETRYING'];

/**
 * The CAS + outbox core, the same shape as ensureLessonGeneration and its
 * translation counterpart.
 *
 * Claim-or-create rather than an upsert: an upsert that fails to match attempts
 * an insert, trips the unique index and aborts the transaction, turning "someone
 * is already generating this" — an ordinary outcome — into an error.
 */
async function ensureAudioGeneration({ lessonId, courseId, userId, language, voice, sourceContentHash, idempotency = null }) {
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
        maxAttempts: TTS_JOB_ATTEMPTS,
        generationId,
        lastError: null,
        completedAt: null,
      };

      let claimed = await LessonAudio.findOneAndUpdate(
        {
          lesson: lessonId,
          language,
          voice,
          $or: [
            { sourceContentHash: { $ne: sourceContentHash } },
            { status: { $in: ['PENDING', 'FAILED'] } },
          ],
        },
        { $set: claimFields },
        { session, returnDocument: 'after' }
      );

      if (!claimed) {
        const current = await LessonAudio.findOne({ lesson: lessonId, language, voice }).session(session);

        if (current) {
          result = { transitioned: false };
          return;
        }

        const [created] = await LessonAudio.create(
          [{ lesson: lessonId, language, voice, totalSegments: 0, readySegments: 0, durationSeconds: 0, ...claimFields }],
          { session }
        );
        claimed = created;
      }

      // Segments from a previous cycle describe a script that no longer matches.
      // Dropped here rather than in the worker so a reader polling between the
      // claim and the first synthesis never sees last run's URLs presented as
      // this run's progress.
      //
      // Only when the source actually moved: a retry of the SAME content must
      // keep its finished segments, or resuming would re-pay for all of them.
      if (claimed.sourceContentHash !== sourceContentHash) {
        await LessonAudioSegment.deleteMany({ audio: claimed._id }).session(session);
      }

      await OutboxEvent.create(
        [{
          eventId: `lesson-tts-${lessonId}-${language}-${voice}-${generationId}`,
          type: 'LESSON_TTS_REQUESTED',
          aggregateType: 'LessonAudio',
          aggregateId: claimed._id,
          payload: {
            audioId: String(claimed._id),
            lessonId: String(lessonId),
            courseId: String(courseId),
            userId: String(userId),
            language,
            voice,
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
            resourceType: 'LESSON_TTS',
            resourceId: claimed._id,
            statusCode: 202,
            response: idempotency.response,
          }],
          { session }
        );
      }

      result = { transitioned: true, audio: claimed };
    });

    // Only after the transaction commits.
    if (result?.transitioned) {
      await publishAudioEvent(lessonId, {
        type: 'audio_queued',
        status: 'GENERATING',
        stage: 'queued',
        progress: 0,
        attempt: 0,
        maxAttempts: TTS_JOB_ATTEMPTS,
      });
    }

    return result;
  } finally {
    await session.endSession();
  }
}

async function describe(audio, lessonId) {
  const segments = await LessonAudioSegment.find({ audio: audio._id }).sort({ sequence: 1 }).lean();
  return toAudioDTO(audio, { lessonId, segments });
}

/**
 * Start (or short-circuit) audio generation for a lesson.
 *
 * Idempotent three times over — the Idempotency-Key replay cache, the cached
 * artifact check, and the CAS claim — because a TTS run is the most expensive
 * thing this application can be asked to do by accident.
 */
export async function requestLessonAudio({ userId, courseId, moduleId, lessonId, idempotencyKey, requestHash }) {
  const language = TTS_LANGUAGE;
  const voice = TTS_VOICE;

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

  // 3. Nothing to read aloud until the lesson exists.
  if (lesson.status !== 'READY') {
    throw ApiError.conflict('Lesson content is not available yet', { code: 'LESSON_NOT_READY' });
  }

  const sourceContentHash = hashLessonContent(lesson.content);

  // 4. Cache check. A row whose hash matches the live lesson is usable; one whose
  // hash differs describes content that has since changed and is regenerated.
  const existing = await LessonAudio.findOne({ lesson: lessonId, language, voice });

  if (existing && existing.sourceContentHash === sourceContentHash) {
    if (existing.status === 'READY') {
      return {
        isCached: false,
        statusCode: 200,
        data: { success: true, message: 'Audio already available', ...(await describe(existing, lessonId)) },
      };
    }

    if (IN_FLIGHT.includes(existing.status)) {
      // Deliberately the full DTO, not a bare status: a reader who reloads
      // mid-generation gets back every segment that is already playable rather
      // than starting from silence.
      return {
        isCached: false,
        statusCode: 202,
        data: { success: true, message: 'Audio generation already in progress', ...(await describe(existing, lessonId)) },
      };
    }
  }

  // 5. Claim + enqueue + record the key, committed together.
  const responseBody = {
    success: true,
    message: 'Audio generation started',
    lessonId: String(lessonId),
    language,
    voice,
    status: 'GENERATING',
  };

  let transitioned;
  try {
    ({ transitioned } = await ensureAudioGeneration({
      lessonId, courseId, userId, language, voice, sourceContentHash,
      idempotency: { key: idempotencyKey, requestHash, response: responseBody },
    }));
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.userId && error?.keyPattern?.key) {
      const raceWinner = await IdempotencyKey.findOne({ userId, key: idempotencyKey });

      if (raceWinner && raceWinner.requestHash === requestHash) {
        return { isCached: true, statusCode: raceWinner.statusCode, data: raceWinner.response };
      }

      throw ApiError.conflict('Idempotency-Key was already used with a different request payload', { code: 'IDEMPOTENCY_CONFLICT' });
    }

    // Two concurrent first-requests raced the insert; the loser reports the
    // winner's state rather than failing a request that got what it wanted.
    if (error?.code === 11000) {
      const winner = await LessonAudio.findOne({ lesson: lessonId, language, voice });
      if (winner) {
        return {
          isCached: false,
          statusCode: 202,
          data: { success: true, message: 'Audio generation already in progress', ...(await describe(winner, lessonId)) },
        };
      }
    }

    throw error;
  }

  if (!transitioned) {
    const current = await LessonAudio.findOne({ lesson: lessonId, language, voice });
    return {
      isCached: false,
      statusCode: current?.status === 'READY' ? 200 : 202,
      data: { success: true, message: 'Audio already requested', ...(await describe(current, lessonId)) },
    };
  }

  return { isCached: false, statusCode: 202, data: responseBody };
}

/**
 * Read a lesson's audio and every segment.
 *
 * Side-effect free, and reports the live staleness verdict rather than trusting
 * the stored row — audio derived from content that has since been regenerated
 * would read a lesson that no longer exists.
 */
export async function getLessonAudio({ userId, courseId, moduleId, lessonId }) {
  const lesson = await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });

  const audio = await LessonAudio.findOne({
    lesson: lessonId,
    language: TTS_LANGUAGE,
    voice: TTS_VOICE,
  }).lean();

  if (!audio) {
    return { lessonId: String(lessonId), status: 'NOT_REQUESTED', segments: [] };
  }

  if (audio.sourceContentHash !== hashLessonContent(lesson.content)) {
    return { lessonId: String(lessonId), status: 'STALE', segments: [] };
  }

  return describe(audio, lessonId);
}
