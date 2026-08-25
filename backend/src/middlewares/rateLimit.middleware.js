import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisConnection } from '../config/redis.config.js';

/**
 * Guards the endpoints that cost a real AI call.
 *
 * Redis-backed rather than the default in-memory store: that store is per-process, so
 * the limit would silently multiply by the number of API instances. Redis is already a
 * hard dependency here.
 *
 * Keyed by user id, not IP — the limit should follow the account, so it cannot be
 * sidestepped by changing network and does not punish everyone behind one NAT.
 */
export const generationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // These routes are always authenticated, so the user branch is the real one. The IP
  // fallback must go through ipKeyGenerator: raw req.ip lets an IPv6 client rotate
  // through its /64 to reset the counter.
  keyGenerator: (req) => (req.user ? `u:${req.user._id}` : ipKeyGenerator(req.ip)),
  store: new RedisStore({
    prefix: 'ratelimit:generation:',
    sendCommand: (...args) => redisConnection.call(...args),
  }),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many generation requests. Please try again later.',
      code: 'RATE_LIMITED',
    });
  },
});
