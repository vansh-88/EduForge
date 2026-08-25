/**
 * Escapes regex metacharacters so user input can be used as a literal substring in a
 * $regex query. Without this, an input like `(a+)+$` is a ReDoS against the database,
 * and characters like `.` or `*` silently change what the user meant to search for.
 */
export function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
