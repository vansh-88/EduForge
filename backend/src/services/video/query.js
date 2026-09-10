import crypto from 'node:crypto';

/**
 * Search-query shaping for video slots.
 *
 * The model supplies only the primary query. The fallback is derived here rather
 * than generated, because asking the model for one made lesson generation fail
 * about two runs in three — it degenerated on the field and blew the output
 * limit. Dropping qualifiers from a phrase is a mechanical operation; it does
 * not need a language model, and doing it in code cannot fail.
 */

// Words that narrow a search without naming the subject. Removing them is what
// "broaden the query" actually means in practice.
const QUALIFIERS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'vs',
  'versus', 'what', 'is', 'are', 'how', 'why', 'when', 'does', 'do', 'explained',
  'explanation', 'introduction', 'intro', 'guide', 'walkthrough', 'detailed',
  'complete', 'comprehensive', 'practical', 'basics', 'basic', 'advanced',
  'deep', 'dive', 'step', 'by', 'overview', 'concept', 'concepts', 'using',
  'understanding', 'understand', 'beginners', 'beginner',
  // Stripped so it is not doubled when re-appended below; a query that was
  // already "<subject> tutorial" then derives to itself and is skipped.
  'tutorial', 'tutorials',
]);

// Long enough for a real phrase, short enough that a degenerate value from any
// future source is contained rather than sent to the provider.
const MAX_QUERY_CHARS = 200;
const MAX_FALLBACK_WORDS = 5;

const words = (text) => text.split(/\s+/).filter(Boolean);

/** Trim and hard-cap a model-supplied query before it reaches a provider. */
export function normalizeQuery(query) {
  return String(query ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_CHARS);
}

/**
 * A broader retry for `query`: the subject words, qualifiers removed, plus
 * "tutorial" so the result still skews educational.
 *
 * Returns null when it would not be meaningfully different from the original —
 * there is no point spending a second 100-unit search on the same phrase.
 */
export function deriveFallbackQuery(query) {
  const original = normalizeQuery(query);
  if (!original) return null;

  const subject = words(original)
    .filter((word) => !QUALIFIERS.has(word.toLowerCase()))
    .slice(0, MAX_FALLBACK_WORDS);

  // Nothing but qualifiers, or nothing left to trim.
  if (subject.length === 0) return null;

  // Too thin to be a real search. Stripping "the basics of what is it" down to
  // "it" leaves a phrase that would spend 100 quota units to find nothing —
  // better to skip the fallback than to pay for a guaranteed miss.
  const subjectText = subject.join(' ');
  if (subjectText.length < 6 || !subject.some((word) => word.length >= 3)) return null;

  const fallback = `${subjectText} tutorial`;

  if (fallback.toLowerCase() === original.toLowerCase()) return null;

  return fallback;
}

/**
 * Cache key for a query. Case- and whitespace-insensitive so that trivially
 * different phrasings share a cached result — every hit saves 100 quota units.
 */
export function queryCacheKey(query) {
  const normalized = normalizeQuery(query).toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
