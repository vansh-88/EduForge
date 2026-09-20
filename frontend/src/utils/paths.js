export const coursePath = (courseId) => `/courses/${courseId}`;

// Lessons are addressed through their module, matching the API.
export const lessonPath = (courseId, moduleId, lessonId) =>
  `/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`;

/**
 * The anchor a tutor citation links to inside a lesson.
 *
 * Positional, matching the `blockStart` the knowledge index records against each
 * chunk. Safe for the same reason BlockRenderer keys blocks by position: content is
 * immutable once READY, and a regenerated lesson changes its content hash, which
 * retires every chunk that could have cited it.
 */
export const blockAnchorId = (index) => `b${index}`;

/** A lesson URL that lands on one passage rather than the top of the page. */
export const lessonBlockPath = (courseId, moduleId, lessonId, blockIndex) =>
  typeof blockIndex === 'number'
    ? `${lessonPath(courseId, moduleId, lessonId)}#${blockAnchorId(blockIndex)}`
    : lessonPath(courseId, moduleId, lessonId);
