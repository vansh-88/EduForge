import { Queue } from 'bullmq';

import { redisConnection } from '../../config/redis.config.js';
import { queueJobOptions } from '../../config/queue.config.js';

export const KNOWLEDGE_QUEUE_NAME = 'lesson-indexing';

/**
 * Indexing a lesson into the tutor's knowledge base.
 *
 * On the shared job options unchanged. Unlike TTS there is nothing here worth
 * tuning separately: one job is one embedding call, so three attempts with
 * exponential backoff is exactly the right amount of patience.
 */
export const lessonIndexingQueue = new Queue(
  KNOWLEDGE_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: queueJobOptions,
  }
);
