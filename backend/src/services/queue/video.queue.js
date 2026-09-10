import { Queue } from 'bullmq';

import { redisConnection } from '../../config/redis.config.js';
import { queueJobOptions } from '../../config/queue.config.js';
import { VIDEO_JOB_ATTEMPTS } from '../../config/env.config.js';

export const VIDEO_QUEUE_NAME = 'video-resolution';

export const videoResolutionQueue = new Queue(VIDEO_QUEUE_NAME, {
  connection: redisConnection,

  defaultJobOptions: {
    ...queueJobOptions,
    // Video resolution has its own attempt budget: these jobs fail against a
    // third-party API rather than an AI provider, and a slot that never resolves
    // costs the reader nothing, so there is no reason to tie it to the
    // generation retry count.
    attempts: VIDEO_JOB_ATTEMPTS,
  },
});
