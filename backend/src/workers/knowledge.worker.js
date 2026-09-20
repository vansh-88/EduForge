import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.config.js';
import { workerConfig } from '../config/worker.config.js';
import { runLessonIndexing } from './processors/lessonIndexing.processor.js';
import { KNOWLEDGE_QUEUE_NAME } from '../services/queue/knowledge.queue.js';

export const knowledgeWorker = new Worker(
  KNOWLEDGE_QUEUE_NAME,
  async (job) => {
    const { lessonId, courseId, source } = job.data;
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = job.attemptsMade + 1;

    console.log(`[KnowledgeWorker] ⚙️ Processing job=${job.id} lesson=${lessonId} attempt=${currentAttempt}/${maxAttempts}`);

    return await runLessonIndexing({ lessonId, courseId, source });
  },
  {
    connection: redisConnection,
    concurrency: workerConfig.knowledge.concurrency,
    // The default 60s lock is right here: one job is a Mongo read, one embedding
    // call and one transactional write — seconds, not the minutes a lesson of
    // speech takes.
  }
);


knowledgeWorker.on('completed', (job) => {
  console.log(`[KnowledgeWorker] ✅ Job completed: ${job.id}`);
});


/*
 * No stranded-document release here, unlike the other workers.
 *
 * They each own a row whose status must be moved out of PROCESSING or a reader's
 * SSE stream never closes. Indexing owns no such row: a lesson that fails to index
 * simply has no chunks, retrieval already treats that as "nothing to retrieve",
 * and the next generation or backfill requests it again. Inventing a lifecycle to
 * release would be machinery guarding nothing.
 */
knowledgeWorker.on('failed', (job, error) => {
  const maxAttempts = job?.opts?.attempts;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;

  if (currentAttempt < maxAttempts) {
    console.warn(`[KnowledgeWorker] ⚠️ Job attempt ${currentAttempt}/${maxAttempts} failed: ${job?.id}. Scheduled for retry. Cause: ${error?.message ?? 'unknown error'}`);
    return;
  }

  // Worth logging loudly even though nothing is stranded: a lesson that never
  // indexes is invisible to the tutor, and the only symptom a user reports is
  // that its answers feel thin.
  console.error(`[KnowledgeWorker] ❌ Lesson ${job?.data?.lessonId} failed to index after ${maxAttempts} attempts: ${error?.message ?? 'unknown error'}`);
});


knowledgeWorker.on('error', (error) => {
  console.error('[KnowledgeWorker] 🚨 Internal worker error:', error);
});
