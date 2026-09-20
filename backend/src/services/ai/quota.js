import { redisFailFast } from '../../config/redis.config.js';
import { AI_DAILY_REQUEST_BUDGET, AI_TTS_DAILY_REQUEST_BUDGET, AI_EMBEDDING_DAILY_REQUEST_BUDGET } from '../../config/env.config.js';
import { GEMINI_MODEL, GEMINI_TTS_MODEL, GEMINI_EMBEDDING_MODEL } from '../../config/env.config.js';
import { ProviderQuotaError } from './providerError.js';

/**
 * Daily request accounting for the AI provider, and a circuit breaker for when
 * it runs out.
 *
 * The same shape as services/video/quota.js, and for the same reason: a shared,
 * finite, daily budget that the application has to be able to ask about BEFORE
 * spending. What forced it here was watching the free tier's ten TTS requests
 * per day disappear and only finding out one 429 at a time — each rejection
 * arriving in milliseconds, so a job burned its whole retry budget in seconds
 * and reported "failed after 3 attempts" instead of "out until tomorrow".
 *
 * Two mechanisms, deliberately distinct:
 *
 *   the counter  — what WE believe we have spent. Approximate: it can drift if a
 *                  request dies after the provider counted it, so it is a guard
 *                  rail, not an authority.
 *   the breaker  — what the PROVIDER told us. Set only when a real daily-quota
 *                  429 comes back, and authoritative until the quota resets.
 *
 * The counter stops us walking into the wall; the breaker stops us walking into
 * it repeatedly once we have.
 */

// Gemini's free-tier quotas reset at midnight Pacific, the same as YouTube's, so
// the counter is keyed by the Pacific date and expires when the real budget does
// rather than drifting against the server's timezone.
function pacificDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Seconds until the next Pacific midnight — when the budget refills. */
export function secondsUntilReset(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);

  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = get('hour') % 24;

  const elapsed = (hour * 60 + get('minute')) * 60 + get('second');
  return 24 * 60 * 60 - elapsed || 24 * 60 * 60;
}

const counterKey = (model) => `ai:quota:${pacificDate()}:${model}`;
const breakerKey = (model) => `ai:exhausted:${model}`;

/** The configured daily allowance for a model. */
export function budgetFor(model) {
  if (model === GEMINI_TTS_MODEL) return AI_TTS_DAILY_REQUEST_BUDGET;
  // Its own bucket rather than a share of the general one: indexing a back
  // catalogue of courses is a single burst of many calls, and it must not be able
  // to spend the allowance that lesson generation depends on.
  if (model === GEMINI_EMBEDDING_MODEL) return AI_EMBEDDING_DAILY_REQUEST_BUDGET;
  return AI_DAILY_REQUEST_BUDGET;
}

export async function requestsUsed(model) {
  try {
    return Number((await redisFailFast.get(counterKey(model))) ?? 0);
  } catch {
    // Redis is unavailable. Report zero rather than blocking every AI call over a
    // cache outage — the provider's own 429 remains the backstop.
    return 0;
  }
}

/** Records requests actually issued, whether or not they succeeded. */
export async function recordSpend(model, count = 1) {
  if (!count) return;

  try {
    const key = counterKey(model);
    const total = await redisFailFast.incrby(key, count);
    // Set on the first write of the day. 48h rather than exactly-until-reset so a
    // clock skew at the boundary cannot drop the day's count early.
    if (total === count) await redisFailFast.expire(key, 48 * 60 * 60);
  } catch {
    // Best-effort, like the pub/sub publishes.
  }
}

/**
 * Trips the breaker for the rest of the quota day.
 *
 * Called when the provider itself reports a daily-quota 429. From here on, calls
 * for this model fail locally in microseconds instead of making a round trip to
 * be refused — which is what stops a queue of doomed jobs from each spending
 * their retries discovering the same thing.
 */
export async function markExhausted(model, ttlSeconds = null) {
  try {
    await redisFailFast.set(breakerKey(model), '1', 'EX', ttlSeconds ?? secondsUntilReset());
  } catch {
    // If we cannot record it, the next call simply learns it from the provider again.
  }
}

export async function isExhausted(model) {
  try {
    return (await redisFailFast.get(breakerKey(model))) !== null;
  } catch {
    return false;
  }
}

/** Clears the breaker. Exported for operational recovery after topping up a quota. */
export async function clearExhausted(model) {
  try {
    await redisFailFast.del(breakerKey(model));
  } catch {
    // Nothing to do — it expires on its own.
  }
}

/**
 * Whether `count` more requests can be issued for this model right now.
 *
 * Check-then-spend rather than an atomic reservation, exactly as the video quota
 * does: worker concurrency is low single digits, so the worst case is a couple
 * of requests crossing the line — and the provider's 429 catches that. An atomic
 * reserve-and-refund would be more machinery than the problem deserves.
 */
export async function canSpend(model, count = 1) {
  if (await isExhausted(model)) return false;

  const budget = budgetFor(model);
  if (!budget || budget <= 0) return true; // unmetered (a paid key)

  return (await requestsUsed(model)) + count <= budget;
}

/** Throws the same error shape the provider would, without the round trip. */
export async function assertCanSpend(model, count = 1) {
  if (await canSpend(model, count)) return;

  throw new ProviderQuotaError(
    `Daily request budget for ${model} is exhausted. It resets in about ${Math.ceil(secondsUntilReset() / 3600)}h.`,
    { daily: true, retryAfterSeconds: secondsUntilReset(), model }
  );
}

/** A snapshot for the readiness probe and for telling a user why something is unavailable. */
export async function quotaStatus() {
  const models = [...new Set([GEMINI_MODEL, GEMINI_TTS_MODEL, GEMINI_EMBEDDING_MODEL])];

  const rows = await Promise.all(
    models.map(async (model) => ({
      model,
      used: await requestsUsed(model),
      budget: budgetFor(model),
      exhausted: await isExhausted(model),
    }))
  );

  return { resetsInSeconds: secondsUntilReset(), models: rows };
}
