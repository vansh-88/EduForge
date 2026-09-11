import {COURSE_WORKER_CONCURRENCY, LESSON_WORKER_CONCURRENCY, VIDEO_WORKER_CONCURRENCY, TRANSLATION_WORKER_CONCURRENCY, TTS_WORKER_CONCURRENCY} from './env.config.js';


export const workerConfig = {
  course: {
    concurrency: COURSE_WORKER_CONCURRENCY,
  },
  lesson: {
    concurrency: LESSON_WORKER_CONCURRENCY,
  },
  video: {
    concurrency: VIDEO_WORKER_CONCURRENCY,
  },
  translation: {
    concurrency: TRANSLATION_WORKER_CONCURRENCY,
  },
  tts: {
    concurrency: TTS_WORKER_CONCURRENCY,
  },
};
