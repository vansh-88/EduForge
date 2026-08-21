import { Worker } from 'bullmq';
import { redisConnection, workerConfig } from '../config/index.js';
import { runAiLessonGeneration } from './processors/lessonGeneration.processor.js';
import { LESSON_QUEUE_NAME } from '../services/queue/lesson.queue.js';

export const lessonWorker = new Worker(
  LESSON_QUEUE_NAME,
  async (job) => {
    const { lessonId, courseId, userId, generationId } = job.data;
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = job.attemptsMade + 1;

    console.log(`[LessonWorker] ⚙️ Processing job=${job.id} lesson=${lessonId} generation=${generationId} attempt=${currentAttempt}/${maxAttempts}`);

    await job.updateProgress({ stage: 'GENERATION_STARTED' });

    return await runAiLessonGeneration({ lessonId, courseId, userId, generationId, job });
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

lessonWorker.on('failed', (job, error) => {
  const maxAttempts = job?.opts?.attempts || 3;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;

  if (currentAttempt >= maxAttempts) {
    console.error(`[LessonWorker] ❌ Job exhausted all retries (${maxAttempts}): ${job?.id}. Marked as FAILED.`);
  } else {
    console.warn(`[LessonWorker] ⚠️ Job attempt ${currentAttempt} failed: ${job?.id}. Scheduled for retry.`);
  }
});

lessonWorker.on('error', (error) => {
  console.error('[LessonWorker] 🚨 Internal worker error:', error);
});