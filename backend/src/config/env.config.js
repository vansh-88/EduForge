import dotenv from 'dotenv';
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const MONGO_URI = process.env.MONGO_URI;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';


/*
|--------------------------------------------------------------------------
| Queue configuration
|--------------------------------------------------------------------------
*/


const QUEUE_ATTEMPTS = Number(process.env.QUEUE_ATTEMPTS || 3);
const QUEUE_BACKOFF_TYPE = process.env.QUEUE_BACKOFF_TYPE || 'exponential';
const QUEUE_BACKOFF_DELAY = Number(process.env.QUEUE_BACKOFF_DELAY || 2000);
const COURSE_WORKER_CONCURRENCY = Number(process.env.COURSE_WORKER_CONCURRENCY || 2);


/*
|--------------------------------------------------------------------------
| Outbox configuration
|--------------------------------------------------------------------------
*/


const OUTBOX_POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 2000);
const OUTBOX_BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE || 10);
const OUTBOX_MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS || 10);


/*
|--------------------------------------------------------------------------
| Validation
|--------------------------------------------------------------------------
*/


if (!MONGO_URI) {
  throw new Error('MONGO_URI is not defined');
}

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not defined');
}



export {
  NODE_ENV,
  PORT,
  MONGO_URI,
  CORS_ORIGIN,

  GEMINI_API_KEY,
  AI_PROVIDER,
  GEMINI_MODEL,

  REDIS_URL,

  QUEUE_ATTEMPTS,
  QUEUE_BACKOFF_TYPE,
  QUEUE_BACKOFF_DELAY,
  COURSE_WORKER_CONCURRENCY,

  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
};