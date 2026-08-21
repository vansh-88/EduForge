import { Queue } from 'bullmq';

import {redisConnection, queueJobOptions } from '../../config/index.js';

export const LESSON_QUEUE_NAME = 'lesson-generation';

export const lessonGenerationQueue = new Queue(
  LESSON_QUEUE_NAME,
  {
    connection: redisConnection,

    defaultJobOptions: queueJobOptions,
  }
);