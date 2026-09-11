import crypto from 'node:crypto';

/**
 * Canonical JSON: object keys sorted, recursively.
 *
 * Lesson content is stored as `Mixed`, so neither Mongoose nor BSON guarantees
 * key order survives a round trip — two reads of the same untouched document can
 * serialize differently. Hashing JSON.stringify output directly would therefore
 * produce a different hash for identical content and silently invalidate every
 * cached artifact. Array order is meaningful and is left alone.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  return value;
}

/**
 * The cache key for every artifact derived from a lesson — translations today,
 * audio next.
 *
 * An artifact whose stored hash no longer matches the lesson it came from was
 * derived from content that has since changed, so it is stale and must be
 * regenerated rather than served.
 */
export function hashLessonContent(content = []) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(content)))
    .digest('hex');
}
