import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.config.js';
import { workerConfig } from '../config/worker.config.js';
import { runLessonTranslation } from './processors/lessonTranslation.processor.js';
import { TRANSLATION_QUEUE_NAME } from '../services/queue/translation.queue.js';
import { LessonTranslation } from '../models/index.js';
import { publishTranslationEvent } from '../services/realtime/generationEvents.js';

export const translationWorker = new Worker(
  TRANSLATION_QUEUE_NAME,
  async (job) => {
    const { translationId, lessonId, language, generationId, sourceContentHash } = job.data;
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = job.attemptsMade + 1;

    console.log(`[TranslationWorker] ⚙️ Processing job=${job.id} lesson=${lessonId} language=${language} generation=${generationId} attempt=${currentAttempt}/${maxAttempts}`);

    await job.updateProgress({ stage: 'TRANSLATION_STARTED' });

    return await runLessonTranslation({
      translationId,
      lessonId,
      language,
      generationId,
      sourceContentHash,
      job,
    });
  },
  {
    connection: redisConnection,
    concurrency: workerConfig.translation.concurrency,
    lockDuration: 60000,
  }
);


translationWorker.on('completed', (job) => {
  console.log(`[TranslationWorker] ✅ Job completed: ${job.id}`);
});


translationWorker.on('failed', async (job, error) => {
  const maxAttempts = job?.opts?.attempts;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;
  const { translationId, lessonId, language } = job?.data ?? {};

  // A stall-out is terminal but does NOT bump attemptsMade — BullMQ counts stalls
  // separately as `stc` and fails the job once it exceeds maxStalledCount. Judging
  // by attemptsMade alone reads that as "will be retried", so we would skip the
  // release below and strand the translation in PROCESSING forever — the exact
  // dead-end this handler exists to prevent.
  const stalledOut = /stalled more than allowable limit/i.test(error?.message ?? '');

  if (currentAttempt < maxAttempts && !stalledOut) {
    console.warn(`[TranslationWorker] ⚠️ Job attempt ${currentAttempt} failed: ${job?.id}. Scheduled for retry.`);
    return;
  }

  console.error(
    stalledOut
      ? `[TranslationWorker] ❌ Job stalled past the allowable limit: ${job?.id}.`
      : `[TranslationWorker] ❌ Job exhausted all retries (${maxAttempts}): ${job?.id}.`
  );

  if (!translationId) return;

  // Safety net. Normally the processor's catch block has already persisted FAILED
  // and this update matches nothing. But a job that stalled out never re-enters
  // the processor at all — this is then the ONLY writer that can release the row
  // from a non-terminal state, and without it the reader's SSE stream never closes.
  try {
    const released = await LessonTranslation.findOneAndUpdate(
      { _id: translationId, status: { $in: ['GENERATING', 'PROCESSING', 'RETRYING'] } },
      {
        $set: {
          status: 'FAILED',
          lastError: stalledOut
            ? `Translation stalled and was abandoned: ${error?.message ?? 'unknown error'}`
            : `Translation failed after ${maxAttempts} attempts: ${error?.message ?? 'unknown error'}`,
          completedAt: null,
        },
      },
      { returnDocument: 'after' }
    );

    if (!released) return;

    console.error(`[TranslationWorker] 🚨 Released stranded translation ${translationId} to FAILED.`);

    await publishTranslationEvent(lessonId, language, {
      type: 'lesson_translation_failed',
      status: 'FAILED',
      stage: released.stage,
      progress: released.progress,
      attempt: released.attempts,
      maxAttempts: released.maxAttempts ?? maxAttempts,
      lastError: released.lastError,
    });
  } catch (err) {
    console.error(`[TranslationWorker] 🚨 Failed to release translation ${translationId}:`, err.message);
  }
});


translationWorker.on('error', (error) => {
  console.error('[TranslationWorker] 🚨 Internal worker error:', error);
});
