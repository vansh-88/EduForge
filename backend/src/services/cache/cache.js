import { redisConnection } from '../../config/redis.config.js';

/**
 * A small read-through cache for expensive derived reads.
 *
 * Deliberately narrow. Most reads here are a single indexed MongoDB query
 * against one user's own documents, and caching those would buy little while
 * adding an invalidation path to every write — the classic way a cache turns a
 * correctness problem into a mystery. What it IS for is the handful of reads
 * that fan out into several aggregations and tolerate being a minute stale.
 *
 * Every operation fails open: a cache outage must degrade to "slower", never to
 * "broken". That is why nothing here rethrows.
 */

const PREFIX = 'cache:';

export async function readCache(key) {
  try {
    const raw = await redisConnection.get(`${PREFIX}${key}`);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function writeCache(key, value, ttlSeconds) {
  try {
    await redisConnection.set(`${PREFIX}${key}`, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Best-effort.
  }
}

export async function invalidateCache(key) {
  try {
    await redisConnection.del(`${PREFIX}${key}`);
  } catch {
    // Best-effort. The TTL is the backstop, which is why every entry has one.
  }
}

/**
 * Read-through: return the cached value, or compute, store and return it.
 *
 * `compute` runs outside any lock, so a cold key hit by several requests at once
 * computes more than once. That is the right trade here — the alternative is a
 * distributed lock guarding a query that takes milliseconds.
 */
export async function cached(key, ttlSeconds, compute) {
  const hit = await readCache(key);
  if (hit !== undefined) return hit;

  const value = await compute();

  // Never cache nothing — a null would be indistinguishable from a miss on the
  // way back in, so it would be recomputed every time anyway.
  if (value !== undefined && value !== null) await writeCache(key, value, ttlSeconds);

  return value;
}
