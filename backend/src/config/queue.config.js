import {QUEUE_ATTEMPTS, QUEUE_BACKOFF_TYPE, QUEUE_BACKOFF_DELAY, COURSE_WORKER_CONCURRENCY, } from './env.js';


export const queueJobOptions = {
  attempts: QUEUE_ATTEMPTS,

  backoff: {
    type: QUEUE_BACKOFF_TYPE,
    delay: QUEUE_BACKOFF_DELAY,
  },

  removeOnComplete: {
    age: 60 * 60,
    count: 1000,
  },

  removeOnFail: {
    age: 24 * 60 * 60,
    count: 5000,
  },
};

export const workerConfig = {
  course: {
    concurrency: COURSE_WORKER_CONCURRENCY,
  },
};