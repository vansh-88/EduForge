import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.config.js';
import { workerConfig } from '../config/worker.config.js';
import { runAiCourseGeneration } from './processors/courseGeneration.processor.js';
import {COURSE_QUEUE_NAME} from '../services/queue/course.queue.js';

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


courseWorker.on('failed', (job, error) => {
  const maxAttempts = job?.opts?.attempts || 3;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;

  if (currentAttempt >= maxAttempts) {
    console.error(`[CourseWorker] ❌ Job exhausted all retries (${maxAttempts}): ${job?.id}. Marked as FAILED.`);
  } else {
    console.warn(`[CourseWorker] ⚠️ Job attempt ${currentAttempt} failed: ${job?.id}. Scheduled for retry.`);
  }
});


courseWorker.on('error', (error) => {
  // This catches internal Redis/connection errors, not job-specific errors
  console.error('[CourseWorker] 🚨 Internal worker error:', error);
});
