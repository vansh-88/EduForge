/**
 * Course response shapes. Nothing should return a raw Course document — the
 * same discipline lesson.serializer.js applies, and for the same reason: it is
 * the only way `_id` versus `id` stays settled across the four endpoints that
 * hand back courses.
 *
 * Two shapes, because the reads differ in kind rather than in degree:
 *   toCourseCardDTO   — listings (dashboard, course list). Counts only.
 *   toCourseDetailDTO — the overview page. Carries the nested curriculum.
 */

/** One course as it appears in any listing. */
export function toCourseCardDTO(course) {
  const dto = {
    id: String(course._id),
    // Null until generation produces one; clients fall back to `query`.
    title: course.title ?? null,
    query: course.query,
    description: course.description ?? null,
    difficulty: course.difficulty,
    status: course.status,
    moduleCount: course.moduleCount,
    lessonCount: course.lessonCount,
    createdAt: course.createdAt,
  };

  // Only the course list selects tags; omitting the key entirely keeps the
  // dashboard payload from growing an always-empty array.
  if (course.tags !== undefined) dto.tags = course.tags ?? [];

  return dto;
}

/** One lesson as it appears inside a course's curriculum — never its content. */
function toCurriculumLessonDTO(lesson) {
  return {
    id: String(lesson._id),
    title: lesson.title,
    order: lesson.order,
    status: lesson.status,
    objectives: lesson.objectives ?? [],
  };
}

function toCurriculumModuleDTO(module) {
  return {
    id: String(module._id),
    title: module.title,
    goal: module.goal,
    order: module.order,
    lessons: (module.lessons ?? []).map(toCurriculumLessonDTO),
  };
}

/**
 * A course with its curriculum, for the overview page.
 *
 * `learningGoals` and `lastError` appear here and not on the card: the first is
 * too long for a listing, and the second only matters on the page that offers
 * the retry.
 */
export function toCourseDetailDTO(course) {
  return {
    ...toCourseCardDTO(course),
    tags: course.tags ?? [],
    learningGoals: course.learningGoals ?? [],
    lastError: course.status === 'FAILED' ? (course.lastError ?? null) : null,
    modules: (course.modules ?? []).map(toCurriculumModuleDTO),
  };
}
