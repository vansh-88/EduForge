import { redisConnection } from '../../config/redis.config.js';
import { YOUTUBE_CACHE_TTL_DAYS } from '../../config/env.config.js';
import { queryCacheKey } from './query.js';

/**
 * Caches the outcome of a provider search.
 *
 * This is the single biggest quota saver: lessons across a course — and across
 * courses on adjacent topics — produce near-identical queries, and every hit is
 * 100 units not spent.
 *
 * A miss is cached as deliberately as a hit. "This phrase finds nothing usable"
 * is exactly as expensive to learn as a hit, and without storing it every
 * regeneration of the same lesson would pay to rediscover it.
 */

const PREFIX = 'yt:search:';
const MISS = '__none__';

const ttlSeconds = () => YOUTUBE_CACHE_TTL_DAYS * 24 * 60 * 60;

/**
 * Returns `{ hit: false }`, `{ hit: true, video }`, or `{ hit: true, video: null }`
 * for a cached miss. The caller must distinguish "not cached" from "cached as
 * nothing" — treating them alike would re-spend the units the miss was cached
 * to avoid.
 */
export async function readCachedSearch(query) {
  let raw;
  try {
    raw = await redisConnection.get(`${PREFIX}${queryCacheKey(query)}`);
  } catch {
    // A cache is an optimization; losing it means paying full price, not failing.
    return { hit: false };
  }

  if (raw === null || raw === undefined) return { hit: false };
  if (raw === MISS) return { hit: true, video: null };

  try {
    return { hit: true, video: JSON.parse(raw) };
  } catch {
    return { hit: false };
  }
}

export async function writeCachedSearch(query, video) {
  try {
    await redisConnection.set(
      `${PREFIX}${queryCacheKey(query)}`,
      video ? JSON.stringify(video) : MISS,
      'EX',
      ttlSeconds()
    );
  } catch {
    // Best-effort, exactly like the pub/sub publishes.
  }
}
