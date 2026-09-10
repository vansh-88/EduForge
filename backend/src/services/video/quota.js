import { redisConnection } from '../../config/redis.config.js';
import {
  YOUTUBE_DAILY_QUOTA_UNITS,
  YOUTUBE_QUOTA_RESERVE,
} from '../../config/env.config.js';

/**
 * Daily quota accounting for the video provider.
 *
 * YouTube's search.list costs 100 units against a 10,000/day default — roughly
 * 100 searches per day for the entire application, shared across every user. So
 * unlike the AI provider, spending here has to be counted rather than assumed
 * available, and a job must be able to ask "can I afford this?" before spending.
 *
 * Counted in Redis rather than MongoDB because it is a hot counter with a
 * natural expiry, and because losing it is harmless — the worst case is that a
 * day's budget is recalculated from zero and the provider's own 403 becomes the
 * backstop.
 */

// YouTube resets quota at midnight Pacific. Keying the counter by the Pacific
// date means the counter expires exactly when the real budget does, rather than
// drifting against whatever timezone the server happens to run in.
export function quotaDateKey(now = new Date()) {
  const pacific = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  return `yt:quota:${pacific}`;
}

/** Milliseconds until the next Pacific midnight — when the budget refills. */
export function msUntilQuotaReset(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);

  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = get('hour') % 24;

  const elapsedMs = ((hour * 60 + get('minute')) * 60 + get('second')) * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  // Never return 0 — a delay of zero would busy-loop the job at the boundary.
  return dayMs - elapsedMs || dayMs;
}

export async function unitsUsed() {
  const raw = await redisConnection.get(quotaDateKey());
  return Number(raw ?? 0);
}

/** The spendable budget, holding back the reserve. */
export function spendableUnits() {
  return YOUTUBE_DAILY_QUOTA_UNITS - YOUTUBE_QUOTA_RESERVE;
}

/**
 * Whether `cost` units can be spent right now.
 *
 * Deliberately a check-then-spend rather than an atomic reservation: slot jobs
 * run at a concurrency of two or three, so the worst case is a couple of
 * requests crossing the line — which the reserve exists to absorb. An atomic
 * reserve-and-refund would be more machinery than the problem deserves.
 */
export async function canSpend(cost) {
  return (await unitsUsed()) + cost <= spendableUnits();
}

/** Records units actually spent. Called even when a search found nothing. */
export async function recordSpend(units) {
  if (!units) return;

  const key = quotaDateKey();
  const total = await redisConnection.incrby(key, units);

  // Set on first write of the day. 48h rather than exactly-until-reset so a
  // clock skew at the boundary cannot drop the day's count early.
  if (total === units) await redisConnection.expire(key, 48 * 60 * 60);
}
