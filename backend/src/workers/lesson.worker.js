import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.config.js';
import { workerConfig } from '../config/worker.config.js';
import { runAiLessonGeneration } from './processors/lessonGeneration.processor.js';
import { LESSON_QUEUE_NAME } from '../services/queue/lesson.queue.js';
import { Lesson } from '../models/index.js';
import { publishGenerationEvent } from '../services/realtime/generationEvents.js';

export const lessonWorker = new Worker(
  LESSON_QUEUE_NAME,
  async (job) => {
    const { lessonId, courseId, userId, generationId, source } = job.data;
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = job.attemptsMade + 1;

    console.log(`[LessonWorker] ⚙️ Processing job=${job.id} lesson=${lessonId} generation=${generationId} attempt=${currentAttempt}/${maxAttempts}`);

    await job.updateProgress({ stage: 'GENERATION_STARTED' });

    return await runAiLessonGeneration({ lessonId, courseId, userId, generationId, source, job });
  },
  {
    connection: redisConnection,
    concurrency: workerConfig.lesson.concurrency,
    lockDuration: 60000,
  }
);


lessonWorker.on('completed', (job) => {
  console.log(`[LessonWorker] ✅ Job completed: ${job.id}`);
});


lessonWorker.on('failed', async (job, error) => {
  const maxAttempts = job?.opts?.attempts;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;
  const lessonId = job?.data?.lessonId;

  // A stall-out is terminal but does NOT bump attemptsMade — BullMQ counts stalls
  // separately as `stc` (moveStalledJobsToWait-9.lua) and fails the job once it
  // exceeds maxStalledCount. Judging by attemptsMade alone reads that as "will be
  // retried", so we would skip the release below and strand the lesson in PROCESSING
  // forever — the exact dead-end this handler exists to prevent.
  const stalledOut = /stalled more than allowable limit/i.test(error?.message ?? '');

  if (currentAttempt < maxAttempts && !stalledOut) {
    console.warn(`[LessonWorker] ⚠️ Job attempt ${currentAttempt} failed: ${job?.id}. Scheduled for retry.`);
    return;
  }

  console.error(
    stalledOut
      ? `[LessonWorker] ❌ Job stalled past the allowable limit: ${job?.id}.`
      : `[LessonWorker] ❌ Job exhausted all retries (${maxAttempts}): ${job?.id}.`
  );

  if (!lessonId) return;

  // Safety net. Normally the processor's catch block has already persisted FAILED,
  // and this update matches nothing. But a job that stalled out (worker killed, or
  // stalled past maxStalledCount) never re-enters the processor at all — this is
  // then the ONLY writer that can release the lesson from a non-terminal state.
  try {
    const released = await Lesson.findOneAndUpdate(
      { _id: lessonId, status: { $in: ['GENERATING', 'PROCESSING', 'RETRYING'] } },
      {
        $set: {
          status: 'FAILED',
          lastError: stalledOut
            ? `Generation stalled and was abandoned: ${error?.message ?? 'unknown error'}`
            : `Generation failed after ${maxAttempts} attempts: ${error?.message ?? 'unknown error'}`,
          completedAt: null,
        },
      },
      { returnDocument: 'after' }
    );

    if (!released) return;

    console.error(`[LessonWorker] 🚨 Released stranded lesson ${lessonId} to FAILED.`);

    await publishGenerationEvent('lesson', lessonId, {
      type: 'lesson_generation_failed',
      status: 'FAILED',
      stage: released.stage,
      progress: released.progress,
      attempt: released.attempts,
      maxAttempts: released.maxAttempts ?? maxAttempts,
      lastError: released.lastError,
    });
  } catch (err) {
    console.error(`[LessonWorker] 🚨 Failed to release lesson ${lessonId}:`, err.message);
  }
});


lessonWorker.on('error', (error) => {
  console.error('[LessonWorker] 🚨 Internal worker error:', error);
});