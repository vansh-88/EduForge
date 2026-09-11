/**
 * Turning a provider's raw failure into something the rest of the system can
 * make a decision about.
 *
 * Gemini reports quota exhaustion as a 429 whose message is a JSON blob. Two
 * very different situations arrive that way and they call for opposite handling:
 *
 *   per-minute limit → wait and retry; the next attempt can genuinely succeed
 *   per-DAY limit    → retrying is pointless. Every attempt is rejected in
 *                      milliseconds, so a job burns its whole retry budget in
 *                      seconds and the reader is told "failed after 3 attempts"
 *                      when the truth is "not until tomorrow".
 *
 * The free tier's TTS allowance is 10 requests per day, and one lesson is one
 * request per section — so this is not an edge case, it is the normal way the
 * feature stops working.
 */

export class ProviderQuotaError extends Error {
  constructor(message, { daily = false, retryAfterSeconds = null, model = null } = {}) {
    super(message);
    this.name = 'ProviderQuotaError';
    this.daily = daily;
    this.retryAfterSeconds = retryAfterSeconds;
    this.model = model;
  }
}

/** Gemini nests the real payload in a JSON string on `error.message`. */
function parseGeminiError(error) {
  const raw = error?.message ?? '';

  try {
    const parsed = JSON.parse(raw);
    return parsed?.error ?? null;
  } catch {
    return null;
  }
}

/**
 * Classifies a provider error, returning the original unchanged when it is not
 * a quota failure — callers still want normal retries for a timeout or a blip.
 */
export function classifyProviderError(error) {
  const payload = parseGeminiError(error);

  const status = payload?.code ?? error?.status;
  if (status !== 429) return error;

  const details = Array.isArray(payload?.details) ? payload.details : [];

  const quotaFailure = details.find((d) => String(d['@type'] ?? '').includes('QuotaFailure'));
  const violation = quotaFailure?.violations?.[0];

  // The quota id is what distinguishes the two cases, e.g.
  // 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' vs a per-minute one.
  const daily = /PerDay/i.test(violation?.quotaId ?? '');

  const retryInfo = details.find((d) => String(d['@type'] ?? '').includes('RetryInfo'));
  const retryAfterSeconds = retryInfo?.retryDelay
    ? Math.ceil(parseFloat(String(retryInfo.retryDelay).replace('s', '')))
    : null;

  const model = violation?.quotaDimensions?.model ?? null;

  const message = daily
    ? `Daily quota exhausted for ${model ?? 'the AI provider'} (limit ${violation?.quotaValue ?? 'unknown'}/day). It resets tomorrow.`
    : `Rate limited by ${model ?? 'the AI provider'}${retryAfterSeconds ? `; retry in ${retryAfterSeconds}s` : ''}.`;

  return new ProviderQuotaError(message, { daily, retryAfterSeconds, model });
}

/**
 * What to show a reader. Provider diagnostics — quota ids, metric names, billing
 * URLs — mean nothing to them and should never reach the UI.
 */
export function toReaderMessage(error) {
  if (error instanceof ProviderQuotaError) {
    return error.daily
      ? 'Audio generation has hit its daily limit and will be available again tomorrow.'
      : 'The narration service is busy right now. Please try again in a minute.';
  }

  return null;
}
