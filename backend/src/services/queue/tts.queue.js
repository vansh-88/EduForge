import { Queue } from 'bullmq';

import { redisConnection } from '../../config/redis.config.js';
import { queueJobOptions } from '../../config/queue.config.js';
import { TTS_JOB_ATTEMPTS } from '../../config/env.config.js';

export const TTS_QUEUE_NAME = 'lesson-tts';

export const lessonTtsQueue = new Queue(
  TTS_QUEUE_NAME,
  {
    connection: redisConnection,

    defaultJobOptions: {
      ...queueJobOptions,
      // Overridden separately from the shared default because a TTS attempt is
      // far more expensive than a text generation — a whole lesson of speech —
      // so how many times it may be repeated is worth tuning on its own.
      attempts: TTS_JOB_ATTEMPTS,
    },
  }
);
