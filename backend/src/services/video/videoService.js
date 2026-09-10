import { provider } from './index.js';
import { readCachedSearch, writeCachedSearch } from './cache.js';
import { canSpend, recordSpend, msUntilQuotaReset } from './quota.js';

/**
 * Raised when the daily provider budget is exhausted.
 *
 * Deliberately not a failure: nothing was searched, so the slot has learned
 * nothing about whether a video exists. Marking it UNAVAILABLE would be a lie,
 * and consuming a retry attempt would burn the slot's budget on a condition that
 * only time fixes. The worker reschedules instead.
 */
export class QuotaExhaustedError extends Error {
  constructor(retryAfterMs) {
    super('Daily video search quota exhausted');
    this.name = 'QuotaExhaustedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Resolve one query, consulting the cache first and the budget second.
 * Returns the video, or null when the search ran and found nothing usable.
 */
async function resolveOne(query, { language }) {
  const cached = await readCachedSearch(query);

  // A cached miss is as authoritative as a cached hit — both mean "already paid
  // to find this out".
  if (cached.hit) return cached.video;

  if (!(await canSpend(provider.searchCost))) {
    throw new QuotaExhaustedError(msUntilQuotaReset());
  }

  let result;
  try {
    result = await provider.resolveQuery(query, { language });
  } catch (error) {
    // The provider reports what it spent only on success. A failed call may
    // still have cost units, but there is no way to know how many — the daily
    // counter is a floor, and the provider's own 403 remains the hard backstop.
    throw error;
  }

  // Recorded whether or not a video was found: the search itself is the cost.
  await recordSpend(result.unitsSpent);
  await writeCachedSearch(query, result.video);

  return result.video;
}

/**
 * Resolve a slot's search: the primary query, then one broader fallback.
 *
 * Two searches is the hard ceiling. At 100 units each against a ~100-search
 * daily budget, a third attempt would cost more than the result is worth.
 */
export async function resolveVideoForSlot({ primaryQuery, fallbackQuery, language = 'en' }) {
  const video = await resolveOne(primaryQuery, { language });
  if (video) return { video, usedFallback: false };

  if (!fallbackQuery) return { video: null, usedFallback: false };

  const fallbackVideo = await resolveOne(fallbackQuery, { language });

  return { video: fallbackVideo, usedFallback: true };
}
