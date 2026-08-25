/**
 * Strips grading data from lesson content. Every lesson response must go
 * through this — never return a raw Lesson document.
 */
export function toLessonContentDTO(content = []) {
  return content.map((block) => {
    if (block.type !== 'mcq') return block;

    const { answer, explanation, ...safe } = block;
    return safe;
  });
}

export function toLessonDTO(lesson, { completed = false } = {}) {
  return {
    id: String(lesson._id),
    title: lesson.title,
    order: lesson.order,
    objectives: lesson.objectives ?? [],
    status: lesson.status,
    content: toLessonContentDTO(lesson.content),
    completed,
    generation: {
      status: lesson.status,
      attempt: lesson.attempts,
      maxAttempts: lesson.maxAttempts,
      stage: lesson.stage,
      progress: lesson.progress,
      lastError: lesson.status === 'FAILED' ? lesson.lastError : null,
      startedAt: lesson.startedAt,
      completedAt: lesson.completedAt,
    },
  };
}