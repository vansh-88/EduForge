import { Queue } from 'bullmq';

import {redisConnection, queueJobOptions } from '../../config/index.js';

export const COURSE_QUEUE_NAME = 'course-generation';

export const courseGenerationQueue = new Queue(
  COURSE_QUEUE_NAME,
  {
    connection: redisConnection,

    defaultJobOptions: queueJobOptions,
  }
);