import {COURSE_WORKER_CONCURRENCY, LESSON_WORKER_CONCURRENCY} from './env.config.js';


export const workerConfig = {
  course: {
    concurrency: COURSE_WORKER_CONCURRENCY,
  },
  lesson: {
    concurrency: LESSON_WORKER_CONCURRENCY,
  },
};
