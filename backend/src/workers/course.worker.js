import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.config.js';
import { workerConfig } from '../config/worker.config.js';
import { runAiCourseGeneration } from './processors/courseGeneration.processor.js';
import {COURSE_QUEUE_NAME} from '../services/queue/course.queue.js';
import { Course } from '../models/index.js';
import { publishGenerationEvent } from '../services/realtime/generationEvents.js';

export const courseWorker = new Worker(
  COURSE_QUEUE_NAME,
  async (job) => {
    const { courseId, userId, topic, generationId } = job.data;
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = job.attemptsMade + 1;

    console.log( `[CourseWorker] ⚙️ Processing job=${job.id} course=${courseId} generation=${generationId} attempt=${currentAttempt}/${maxAttempts}` );

    // Update progress so the frontend could theoretically track it
    await job.updateProgress({ stage: 'GENERATION_STARTED' });

    // Execute the heavy AI logic
    return await runAiCourseGeneration({ courseId, userId, topic, generationId, job });

  },
  {
    connection: redisConnection,
    concurrency: workerConfig.course.concurrency,
    // lockDuration extends the time the worker holds the job before BullMQ assumes it crashed
    lockDuration: 60000, 
  }
);


courseWorker.on('completed', (job) => {
  console.log(`[CourseWorker] ✅ Job completed: ${job.id}`);
});


courseWorker.on('failed', async (job, error) => {
  const maxAttempts = job?.opts?.attempts;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;
  const courseId = job?.data?.courseId;

  // A stall-out is terminal but does NOT bump attemptsMade — BullMQ counts stalls
  // separately as `stc` (moveStalledJobsToWait-9.lua) and fails the job once it
  // exceeds maxStalledCount. Judging by attemptsMade alone reads that as "will be
  // retried", so we would skip the release below and strand the course in PROCESSING
  // forever — the exact dead-end this handler exists to prevent.
  const stalledOut = /stalled more than allowable limit/i.test(error?.message ?? '');

  if (currentAttempt < maxAttempts && !stalledOut) {
    console.warn(`[CourseWorker] ⚠️ Job attempt ${currentAttempt} failed: ${job?.id}. Scheduled for retry.`);
    return;
  }

  console.error(
    stalledOut
      ? `[CourseWorker] ❌ Job stalled past the allowable limit: ${job?.id}.`
      : `[CourseWorker] ❌ Job exhausted all retries (${maxAttempts}): ${job?.id}.`
  );

  if (!courseId) return;

  // Safety net. Normally the processor's catch block has already persisted FAILED and
  // this update matches nothing. But a job that stalled out never re-enters the
  // processor at all — this is then the ONLY writer that can release the course.
  try {
    const released = await Course.findOneAndUpdate(
      { _id: courseId, status: { $in: ['GENERATING', 'PROCESSING', 'RETRYING'] } },
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

    console.error(`[CourseWorker] 🚨 Released stranded course ${courseId} to FAILED.`);

    await publishGenerationEvent('course', courseId, {
      type: 'course_generation_failed',
      status: 'FAILED',
      stage: released.stage,
      progress: released.progress,
      attempt: released.attempts,
      maxAttempts: released.maxAttempts ?? maxAttempts,
      lastError: released.lastError,
    });
  } catch (err) {
    console.error(`[CourseWorker] 🚨 Failed to release course ${courseId}:`, err.message);
  }
});


courseWorker.on('error', (error) => {
  // This catches internal Redis/connection errors, not job-specific errors
  console.error('[CourseWorker] 🚨 Internal worker error:', error);
});
