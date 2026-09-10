export const coursePath = (courseId) => `/courses/${courseId}`;

// Lessons are addressed through their module, matching the API.
export const lessonPath = (courseId, moduleId, lessonId) =>
  `/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`;
