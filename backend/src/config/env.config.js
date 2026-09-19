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


/*
|--------------------------------------------------------------------------
| Rate limiting
|--------------------------------------------------------------------------
|
| Tiered by what a request actually costs. Reads are cheap and frequent;
| generation spends one provider call; audio spends one PER LESSON SECTION, so a
| single request can be worth a dozen of the tier above. One bucket for all of
| them priced abuse the same as ordinary use — and on a free-tier key, a handful
| of audio requests is the entire day.
*/


const RATE_LIMIT_READ_MAX = Number(process.env.RATE_LIMIT_READ_MAX || 300);       // per 15 min
const RATE_LIMIT_WRITE_MAX = Number(process.env.RATE_LIMIT_WRITE_MAX || 100);     // per 15 min
const RATE_LIMIT_STREAM_MAX = Number(process.env.RATE_LIMIT_STREAM_MAX || 60);    // per 5 min
const RATE_LIMIT_GENERATION_MAX = Number(process.env.RATE_LIMIT_GENERATION_MAX || 20); // per hour
const RATE_LIMIT_AUDIO_MAX = Number(process.env.RATE_LIMIT_AUDIO_MAX || 5);       // per hour
const RATE_LIMIT_CHAT_MAX = Number(process.env.RATE_LIMIT_CHAT_MAX || 30);        // per hour


/*
|--------------------------------------------------------------------------
| AI provider budget
|--------------------------------------------------------------------------
|
| A local guard rail in front of the provider's own daily quota, so the
| application can refuse before spending rather than discovering exhaustion one
| 429 at a time. Set to 0 to disable the check entirely, which is what a paid key
| with no meaningful daily cap should do.
|
| The TTS default matches the Gemini free tier's ten requests per day. That is
| roughly two lessons of narration for the whole application, so on a free key
| this is the binding constraint on the feature, not a safety margin.
*/


const AI_DAILY_REQUEST_BUDGET = Number(process.env.AI_DAILY_REQUEST_BUDGET || 200);
const AI_TTS_DAILY_REQUEST_BUDGET = Number(process.env.AI_TTS_DAILY_REQUEST_BUDGET || 10);
const AI_EMBEDDING_DAILY_REQUEST_BUDGET = Number(process.env.AI_EMBEDDING_DAILY_REQUEST_BUDGET || 500);

// How long a cached user-stats snapshot may be stale. Short, because the numbers
// move whenever a lesson is completed and a reader will look for the change.
const STATS_CACHE_TTL_SECONDS = Number(process.env.STATS_CACHE_TTL_SECONDS || 60);


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
| Translation configuration
|--------------------------------------------------------------------------
|
| Translation is a derived artifact: a lesson is fully usable without it, and it
| shares the Gemini quota with lesson generation — which is the feature nobody can
| do without. Concurrency is therefore kept below the lesson worker's on purpose.
|
| The batch bounds exist because asking for a whole lesson's strings in one
| response is where models start truncating and silently dropping entries (the
| same degeneration documented on the lesson schema). Smaller responses come back
| whole, and a failure costs one batch rather than the lesson.
*/


const TRANSLATION_WORKER_CONCURRENCY = Number(process.env.TRANSLATION_WORKER_CONCURRENCY || 2);
const TRANSLATION_BATCH_MAX_ITEMS = Number(process.env.TRANSLATION_BATCH_MAX_ITEMS || 25);
const TRANSLATION_BATCH_MAX_CHARS = Number(process.env.TRANSLATION_BATCH_MAX_CHARS || 6000);


/*
|--------------------------------------------------------------------------
| Text-to-speech configuration
|--------------------------------------------------------------------------
|
| Measured, not guessed: the preview TTS model takes ~12s to speak a single
| sentence and returns headerless 24kHz PCM at 48KB/s. A whole lesson in one
| request would be minutes of latency against a model that is both slow and
| rate-limited, so audio is cut into section-sized segments and generated one at
| a time.
|
| Concurrency is 1 deliberately. Several workers each firing a lesson's worth of
| requests is the fastest way to trip the preview model's rate limit, and the
| reader does not need segment 4 early — they need segment 1 now, which
| progressive playback already gives them.
*/


const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'Kore';
const TTS_LANGUAGE = process.env.TTS_LANGUAGE || 'en';

const TTS_WORKER_CONCURRENCY = Number(process.env.TTS_WORKER_CONCURRENCY || 1);
const TTS_JOB_ATTEMPTS = Number(process.env.TTS_JOB_ATTEMPTS || 3);

// Roughly 90 seconds of speech. Small enough that the first segment arrives
// quickly, large enough that a lesson does not become dozens of requests.
const TTS_SEGMENT_MAX_CHARS = Number(process.env.TTS_SEGMENT_MAX_CHARS || 1800);

// Guards against a pathological lesson turning into an unbounded spend.
const TTS_MAX_SEGMENTS = Number(process.env.TTS_MAX_SEGMENTS || 30);

// A small gap between segment requests, since they are issued back to back
// against a preview-tier model.
const TTS_SEGMENT_DELAY_MS = Number(process.env.TTS_SEGMENT_DELAY_MS || 500);



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
| Course Tutor — knowledge index
|--------------------------------------------------------------------------
|
| Lessons are chunked and embedded so the tutor can retrieve the parts of a
| course that bear on a question. Two constants here are not free to change.
|
| EMBEDDING_DIMENSIONS must match the Atlas vector index exactly — the index
| declares numDimensions, and a vector of any other length is rejected on write.
| Changing it therefore means dropping the index, reindexing every course, and
| rebuilding: it is a migration, not a setting.
|
| 768 rather than the model's native 3072 because the index is a fifth of the
| size for retrieval quality that is, on course-sized corpora, indistinguishable.
| Gemini only returns pre-normalized vectors at 3072, so anything shorter is
| normalized on our side before it is stored.
|
| Embeddings get their own daily budget rather than sharing AI_DAILY_REQUEST_BUDGET,
| because indexing a back catalogue of courses is one burst of many calls and must
| not be able to spend the allowance that lesson generation depends on.
*/


const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 768);

const KNOWLEDGE_WORKER_CONCURRENCY = Number(process.env.KNOWLEDGE_WORKER_CONCURRENCY || 2);

// A chunk has to stand alone once retrieved: large enough to carry a complete
// idea, small enough that five of them are context rather than a wall of text.
// The minimum stops a lesson's trailing fragment becoming a chunk of its own,
// which embeds poorly and crowds out a real one.
const CHUNK_MAX_CHARS = Number(process.env.CHUNK_MAX_CHARS || 1200);
const CHUNK_MIN_CHARS = Number(process.env.CHUNK_MIN_CHARS || 300);

// The name of the Atlas Search index. Referenced by both the schema declaration
// and every $vectorSearch stage, so it lives here rather than as a literal in two
// files that must never disagree.
const VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME || 'course_chunk_vector';


/*
|--------------------------------------------------------------------------
| Course Tutor — chat
|--------------------------------------------------------------------------
|
| The budgets below are character counts, roughly four characters to a token.
| They are not about the model's context window, which is far larger than
| anything assembled here — they are about cost, time to first token, and answer
| quality. A prompt stuffed with marginally relevant course text produces a worse
| answer than a short one, not a better informed one.
|
| Priority when the budget binds: the question, then the current lesson, then
| retrieved chunks, then conversation history oldest-first.
|
| CHAT_ALLOW_GENERAL_KNOWLEDGE decides what happens at the edge of the course.
| On, the tutor says the course does not cover something and then answers anyway,
| marking it as general knowledge — which is what a student asking a legitimate
| prerequisite question needs. Off, it declines and points back to the course.
*/


const CHAT_MODEL = process.env.CHAT_MODEL || GEMINI_MODEL;

const CHAT_ALLOW_GENERAL_KNOWLEDGE = process.env.CHAT_ALLOW_GENERAL_KNOWLEDGE !== 'false';

const CHAT_RETRIEVAL_TOP_K = Number(process.env.CHAT_RETRIEVAL_TOP_K || 5);

const CHAT_HISTORY_MAX_MESSAGES = Number(process.env.CHAT_HISTORY_MAX_MESSAGES || 12);
const CHAT_CONTEXT_LESSON_MAX_CHARS = Number(process.env.CHAT_CONTEXT_LESSON_MAX_CHARS || 8000);
const CHAT_CONTEXT_RETRIEVED_MAX_CHARS = Number(process.env.CHAT_CONTEXT_RETRIEVED_MAX_CHARS || 6000);
const CHAT_CONTEXT_HISTORY_MAX_CHARS = Number(process.env.CHAT_CONTEXT_HISTORY_MAX_CHARS || 4000);

// Long enough for a thorough explanation, short enough that a degenerating model
// cannot stream for minutes on one question.
const CHAT_MAX_OUTPUT_TOKENS = Number(process.env.CHAT_MAX_OUTPUT_TOKENS || 1500);

// What a student may type. Well above a real question, low enough that the
// message body cannot become a channel for smuggling in a prompt.
const CHAT_MESSAGE_MAX_CHARS = Number(process.env.CHAT_MESSAGE_MAX_CHARS || 2000);


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
| Worker wake-up (free-tier hosting)
|--------------------------------------------------------------------------
|
| The worker is deployed as an ordinary web service rather than a dedicated
| background worker, because the free tier does not offer one. Such a service is
| spun down after roughly fifteen minutes without inbound HTTP traffic, and the
| worker process is where the outbox publisher lives — so a sleeping worker does
| not merely stop processing jobs, it stops enqueuing them at all.
|
| Nothing is lost while it sleeps: outbox events are committed to MongoDB and the
| publisher drains whatever accumulated as soon as it comes back. But something
| has to wake it, so the API pings it whenever it writes an event and again while
| a generation stream is open.
|
| WORKER_HTTP is what makes the worker bind a port at all. It is set only on the
| deployed worker service; locally the worker binds nothing and cannot collide
| with the API.
|
| WORKER_WAKE_URL is set only on the API service. Unset — in local development,
| or if both roles ever run in one process — every ping is a no-op, so none of
| this costs anything outside the deployment it exists for.
*/


const WORKER_HTTP = process.env.WORKER_HTTP === 'true';
const WORKER_WAKE_URL = process.env.WORKER_WAKE_URL || null;

// A cold start is around a minute, so pinging more often than this cannot wake
// anything sooner — it only spends requests against a service that is already on
// its way up.
const WORKER_WAKE_MIN_INTERVAL_MS = Number(process.env.WORKER_WAKE_MIN_INTERVAL_MS || 60_000);


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

  RATE_LIMIT_READ_MAX,
  RATE_LIMIT_WRITE_MAX,
  RATE_LIMIT_STREAM_MAX,
  RATE_LIMIT_GENERATION_MAX,
  RATE_LIMIT_AUDIO_MAX,
  RATE_LIMIT_CHAT_MAX,

  AI_DAILY_REQUEST_BUDGET,
  AI_TTS_DAILY_REQUEST_BUDGET,
  AI_EMBEDDING_DAILY_REQUEST_BUDGET,
  STATS_CACHE_TTL_SECONDS,

  QUEUE_ATTEMPTS,
  QUEUE_BACKOFF_TYPE,
  QUEUE_BACKOFF_DELAY,
  COURSE_WORKER_CONCURRENCY,

  LESSON_WORKER_CONCURRENCY,

  TRANSLATION_WORKER_CONCURRENCY,
  TRANSLATION_BATCH_MAX_ITEMS,
  TRANSLATION_BATCH_MAX_CHARS,

  GEMINI_TTS_MODEL,
  TTS_VOICE,
  TTS_LANGUAGE,
  TTS_WORKER_CONCURRENCY,
  TTS_JOB_ATTEMPTS,
  TTS_SEGMENT_MAX_CHARS,
  TTS_MAX_SEGMENTS,
  TTS_SEGMENT_DELAY_MS,

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

  GEMINI_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  KNOWLEDGE_WORKER_CONCURRENCY,
  CHUNK_MAX_CHARS,
  CHUNK_MIN_CHARS,
  VECTOR_INDEX_NAME,

  CHAT_MODEL,
  CHAT_ALLOW_GENERAL_KNOWLEDGE,
  CHAT_RETRIEVAL_TOP_K,
  CHAT_HISTORY_MAX_MESSAGES,
  CHAT_CONTEXT_LESSON_MAX_CHARS,
  CHAT_CONTEXT_RETRIEVED_MAX_CHARS,
  CHAT_CONTEXT_HISTORY_MAX_CHARS,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MESSAGE_MAX_CHARS,

  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,

  WORKER_HTTP,
  WORKER_WAKE_URL,
  WORKER_WAKE_MIN_INTERVAL_MS,

  AUTH0_ISSUER,
  AUTH0_AUDIENCE,

  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
};