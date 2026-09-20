import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisFailFast } from '../config/redis.config.js';
import {
  RATE_LIMIT_READ_MAX,
  RATE_LIMIT_WRITE_MAX,
  RATE_LIMIT_STREAM_MAX,
  RATE_LIMIT_GENERATION_MAX,
  RATE_LIMIT_AUDIO_MAX,
  RATE_LIMIT_CHAT_MAX,
} from '../config/env.config.js';

/**
 * Tiered limits, because the routes cost wildly different amounts.
 *
 * The tiers exist to stop one shape of abuse being priced like another:
 *
 *   read       cheap, frequent — a reader paging through a course
 *   write      a Mongo write, no provider call — answering a question
 *   stream     each SSE connection holds a dedicated Redis subscriber for as
 *              long as it is open, so these are a resource to cap, not just a
 *              request to count
 *   generation ONE provider call — a lesson, a course, a translation
 *   audio      one provider call PER SECTION, so a single request is worth
 *              roughly four to fifteen of the tier above. On the free tier a
 *              handful of these is the entire day's budget, which is exactly
 *              how the TTS quota vanished in testing.
 *
 * Each tier is its own bucket, so exhausting the expensive one never locks a
 * reader out of the lesson they already have.
 *
 * Redis-backed rather than the default in-memory store: that store is
 * per-process, so every limit would silently multiply by the number of API
 * instances.
 *
 * Keyed by user id, not IP — a limit should follow the account, so it cannot be
 * sidestepped by changing network and does not punish everyone behind one NAT.
 * The IP fallback goes through ipKeyGenerator because raw req.ip lets an IPv6
 * client rotate through its /64 to reset the counter.
 */
function makeLimiter({ name, windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? `u:${req.user._id}` : ipKeyGenerator(req.ip)),
    /*
     * Fail OPEN when Redis is unavailable.
     *
     * Two settings together. The fail-fast client makes a command against a dead
     * Redis reject quickly instead of queueing forever — on the shared BullMQ client
     * it would never settle, and since this middleware sits in front of every
     * authenticated route, that meant a Redis outage hung the entire API rather than
     * merely unmetering it.
     *
     * passOnStoreError then decides what to do with that rejection: let the request
     * through. Losing rate limiting during an outage is a real cost, but it is a
     * smaller one than refusing every request — the limiter exists to price abuse,
     * not to be a dependency the whole API is down without.
     */
    passOnStoreError: true,
    store: new RedisStore({
      prefix: `ratelimit:${name}:`,
      sendCommand: (...args) => redisFailFast.call(...args),
    }),
    handler: (req, res) => {
      // A single code the client already knows how to render, with a retry hint
      // so the UI can say when rather than just no.
      res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMITED',
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      });
    },
  });
}

/** Baseline for every authenticated route. Generous — this catches runaways, not users. */
export const readRateLimiter = makeLimiter({
  name: 'read',
  windowMs: 15 * 60 * 1000,
  limit: RATE_LIMIT_READ_MAX,
  message: 'Too many requests. Please slow down and try again shortly.',
});

/** Mutations that hit MongoDB but spend nothing with a provider. */
export const writeRateLimiter = makeLimiter({
  name: 'write',
  windowMs: 15 * 60 * 1000,
  limit: RATE_LIMIT_WRITE_MAX,
  message: 'Too many updates. Please try again in a few minutes.',
});

/**
 * SSE connections.
 *
 * Capped because each open stream holds a duplicated Redis connection for its
 * whole lifetime (see subscribeChannels), so this limits concurrent server
 * resources, not merely request volume.
 */
export const streamRateLimiter = makeLimiter({
  name: 'stream',
  windowMs: 5 * 60 * 1000,
  limit: RATE_LIMIT_STREAM_MAX,
  message: 'Too many live connections opened. Please wait a moment.',
});

/** One provider call: course, lesson, or translation generation. */
export const generationRateLimiter = makeLimiter({
  name: 'generation',
  windowMs: 60 * 60 * 1000,
  limit: RATE_LIMIT_GENERATION_MAX,
  message: 'Too many generation requests. Please try again later.',
});

/**
 * One tutor message.
 *
 * Between the write and generation tiers, because that is genuinely where it sits:
 * one text generation plus one small embedding to retrieve with. What makes it its
 * own bucket rather than a share of the generation tier is shape, not size — a
 * lesson is one request a user makes occasionally, while a conversation is a burst
 * of them, and pricing the two the same either throttles ordinary conversation or
 * leaves generation wide open.
 */
export const chatRateLimiter = makeLimiter({
  name: 'chat',
  windowMs: 60 * 60 * 1000,
  limit: RATE_LIMIT_CHAT_MAX,
  message: 'Too many tutor messages. Please try again later.',
});

/** One provider call per lesson section — the most expensive thing a user can ask for. */
export const audioRateLimiter = makeLimiter({
  name: 'audio',
  windowMs: 60 * 60 * 1000,
  limit: RATE_LIMIT_AUDIO_MAX,
  message: 'Too many audio requests. Narration is limited — please try again later.',
});
