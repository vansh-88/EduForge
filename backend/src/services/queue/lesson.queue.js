import { Queue } from 'bullmq';

import { redisConnection } from '../../config/redis.config.js';
import { queueJobOptions } from '../../config/queue.config.js';

export const LESSON_QUEUE_NAME = 'lesson-generation';

export const lessonGenerationQueue = new Queue(
  LESSON_QUEUE_NAME,
  {
    connection: redisConnection,

    defaultJobOptions: queueJobOptions,
  }
);