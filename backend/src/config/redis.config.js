import IORedis from 'ioredis';
import { REDIS_URL, REDIS_COMMAND_TIMEOUT_MS } from './env.config.js';

/*
 * Two clients, because two kinds of work want opposite things from a Redis outage.
 *
 * BullMQ must never give up. A queued job is durable work that has to run eventually,
 * so its client waits out a blip rather than failing — which is what
 * maxRetriesPerRequest: null means, and BullMQ requires it.
 *
 * Everything else is optional. Quota counters, caches, rate-limit buckets and event
 * publishing all describe themselves as best-effort and all swallow their errors, on
 * the reasoning that a cache outage should degrade to "slower", never to "broken".
 *
 * That reasoning was wrong for as long as those callers shared the BullMQ client.
 * With maxRetriesPerRequest: null and the offline queue enabled, a command issued
 * while Redis is unreachable is neither answered NOR rejected — it is queued until
 * the server returns. It cannot be caught, because it never fails. So the AI budget
 * check in front of every provider call did not fail open at all; it hung, and took
 * the request with it. A dead Redis stopped being a degradation and became a hang in
 * course generation, lesson generation, translation, narration and the tutor alike.
 *
 * Hence the second client. It is configured to fail, quickly and loudly, so that the
 * try/catch those callers already have can do the job it was written to do.
 */

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

/**
 * For everything that must degrade rather than block.
 *
 * The load-bearing setting is maxRetriesPerRequest: a finite number is what bounds
 * the offline queue, so a command issued while Redis is unreachable is rejected
 * after a couple of hundred milliseconds instead of being parked indefinitely.
 * commandTimeout is the second line of defence, for a connection that is up but
 * unresponsive — where no retry limit would ever be reached because nothing failed.
 *
 * The offline queue stays ENABLED, which is worth stating plainly because disabling
 * it looks like the obvious fix and is worse. Measured both ways:
 *
 *                              dead Redis        first command during connect
 *   offlineQueue: false        rejects, 1ms      REJECTS — wrongly
 *   offlineQueue: true         rejects, 206ms    resolves
 *
 * Disabling it buys 200ms during an outage and pays for it by failing every command
 * issued in the window between process start and the connection becoming ready —
 * turning a healthy boot into spurious cache misses, a quota that reads as zero, and
 * a skipped rate limit, on every deploy.
 *
 * Callers do not need to know which client they hold: they catch an error either
 * way. The difference is only that with this one, an error actually arrives.
 */
export const redisFailFast = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  enableReadyCheck: true,
});

redisConnection.on('connect', () => {
  console.log('[Redis] connected');
});

redisConnection.on('ready', () => {
  console.log('[Redis] ready');
});

redisConnection.on('error', (error) => {
  console.error('[Redis] error:', error);
});

redisConnection.on('close', () => {
  console.log('[Redis] connection closed');
});

/*
 * The fail-fast client logs errors at a much lower volume than the primary.
 *
 * While Redis is down it refuses every command immediately, so logging each one
 * would bury the outage in thousands of identical lines — exactly the noise that
 * makes a real incident harder to read. One line per transition is enough; the
 * primary client's handler above still reports the connection state.
 */
let failFastDown = false;

redisFailFast.on('error', (error) => {
  if (failFastDown) return;
  failFastDown = true;
  console.error('[Redis:failfast] degraded — caches, quotas and rate limits are now best-effort:', error.message);
});

redisFailFast.on('ready', () => {
  if (failFastDown) console.log('[Redis:failfast] recovered');
  failFastDown = false;
});
