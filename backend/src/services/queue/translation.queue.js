import { Queue } from 'bullmq';

import { redisConnection } from '../../config/redis.config.js';
import { queueJobOptions } from '../../config/queue.config.js';

export const TRANSLATION_QUEUE_NAME = 'lesson-translation';

export const lessonTranslationQueue = new Queue(
  TRANSLATION_QUEUE_NAME,
  {
    connection: redisConnection,

    defaultJobOptions: queueJobOptions,
  }
);
