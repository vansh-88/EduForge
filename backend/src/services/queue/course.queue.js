import { Queue } from 'bullmq';

import redisConnection from '../../config/redis.config.js';
import { queueJobOptions } from '../../config/queue.config.js';

export const COURSE_QUEUE_NAME = 'course-generation';

export const courseGenerationQueue = new Queue(
  COURSE_QUEUE_NAME,
  {
    connection: redisConnection,

    defaultJobOptions: queueJobOptions,
  }
);