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

const AUTH0_ISSUER = process.env.AUTH0_ISSUER;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

// Single URL of the form cloudinary://<api_key>:<api_secret>@<cloud_name>. Parsed here
// rather than left to the SDK's implicit env lookup, which reads process.env at import
// time and would silently no-op if this module had not loaded dotenv first.
const CLOUDINARY_URL = process.env.CLOUDINARY_URL;


/*
|--------------------------------------------------------------------------
| Queue configuration
|--------------------------------------------------------------------------
*/


const QUEUE_ATTEMPTS = Number(process.env.QUEUE_ATTEMPTS || 3);
const QUEUE_BACKOFF_TYPE = process.env.QUEUE_BACKOFF_TYPE || 'exponential';
const QUEUE_BACKOFF_DELAY = Number(process.env.QUEUE_BACKOFF_DELAY || 2000);


/*
|--------------------------------------------------------------------------
| Lesson Queue configuration
|--------------------------------------------------------------------------
*/


const COURSE_WORKER_CONCURRENCY = Number(process.env.COURSE_WORKER_CONCURRENCY || 2);


/*
|--------------------------------------------------------------------------
| Lesson Queue configuration
|--------------------------------------------------------------------------
*/


const LESSON_WORKER_CONCURRENCY = Number(process.env.LESSON_WORKER_CONCURRENCY || 3);



/*
|--------------------------------------------------------------------------
| Video enrichment configuration
|--------------------------------------------------------------------------
|
| Video resolution is an optional enrichment pass: a lesson is fully usable
| without it. So unlike GEMINI_API_KEY, a missing YOUTUBE_API_KEY does not
| throw at boot — the provider reports the slot UNAVAILABLE instead, and the
| rest of the system carries on.
*/


const VIDEO_PROVIDER = process.env.VIDEO_PROVIDER || 'youtube';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || null;

const VIDEO_WORKER_CONCURRENCY = Number(process.env.VIDEO_WORKER_CONCURRENCY || 2);
const VIDEO_JOB_ATTEMPTS = Number(process.env.VIDEO_JOB_ATTEMPTS || 3);

// A FAILED slot is revived at most this many times, and never sooner than the
// cooldown. Both bound the cost: a permanently unresolvable query must not
// re-spend 100 quota units every time somebody opens the lesson.
const VIDEO_RETRY_MAX_ROUNDS = Number(process.env.VIDEO_RETRY_MAX_ROUNDS || 2);
const VIDEO_RETRY_COOLDOWN_MS = Number(process.env.VIDEO_RETRY_COOLDOWN_MS || 6 * 60 * 60 * 1000);

// search.list costs 100 units against a 10,000/day default quota — roughly 100
// searches per day for the whole application. The reserve keeps a slice back so
// that exhausting the quota on enrichment can never starve anything added later.
const YOUTUBE_DAILY_QUOTA_UNITS = Number(process.env.YOUTUBE_DAILY_QUOTA_UNITS || 10000);
const YOUTUBE_QUOTA_RESERVE = Number(process.env.YOUTUBE_QUOTA_RESERVE || 1000);

// Caching a resolved query is the single biggest quota saver, since lessons on
// adjacent topics produce near-identical searches.
const YOUTUBE_CACHE_TTL_DAYS = Number(process.env.YOUTUBE_CACHE_TTL_DAYS || 30);

// Filter bounds: below the minimum is usually a short/teaser, above the maximum
// is usually a full lecture or conference talk rather than a lesson aid.
const YOUTUBE_MIN_DURATION_S = Number(process.env.YOUTUBE_MIN_DURATION_S || 180);
const YOUTUBE_MAX_DURATION_S = Number(process.env.YOUTUBE_MAX_DURATION_S || 1800);



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

if (!AUTH0_ISSUER || !AUTH0_AUDIENCE) {
  throw new Error('Missing required environment variables: AUTH0_ISSUER, or AUTH0_AUDIENCE');
}

if (!CLOUDINARY_URL) {
  throw new Error('CLOUDINARY_URL is not defined');
}

const cloudinaryParts = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(CLOUDINARY_URL.trim());

if (!cloudinaryParts) {
  throw new Error('CLOUDINARY_URL must look like cloudinary://<api_key>:<api_secret>@<cloud_name>');
}

const [, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME] = cloudinaryParts;


// express-oauth2-jwt-bearer requires the issuer base URL to end with a trailing slash.
export const AUTH0_ISSUER_BASE_URL = AUTH0_ISSUER.endsWith('/') ? AUTH0_ISSUER : `${AUTH0_ISSUER}/`;


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

  LESSON_WORKER_CONCURRENCY,

  VIDEO_PROVIDER,
  YOUTUBE_API_KEY,
  VIDEO_WORKER_CONCURRENCY,
  VIDEO_JOB_ATTEMPTS,
  VIDEO_RETRY_MAX_ROUNDS,
  VIDEO_RETRY_COOLDOWN_MS,
  YOUTUBE_DAILY_QUOTA_UNITS,
  YOUTUBE_QUOTA_RESERVE,
  YOUTUBE_CACHE_TTL_DAYS,
  YOUTUBE_MIN_DURATION_S,
  YOUTUBE_MAX_DURATION_S,

  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,

  AUTH0_ISSUER,
  AUTH0_AUDIENCE,

  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
};