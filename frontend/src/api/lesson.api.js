import apiClient from './client';

// Lessons are addressed through their module — lessonId alone is not enough.
const lessonPath = (courseId, moduleId, lessonId) =>
  `/v1/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`;

const idempotent = () => ({ headers: { 'Idempotency-Key': crypto.randomUUID() } });

/**
 * Reads a lesson. Never triggers generation for the requested lesson — if its
 * status isn't READY, `content` is empty and the caller should start generation
 * and watch the SSE stream.
 *
 * Returns { lesson, quiz, navigation }, where navigation.previous/next are
 * either null or { moduleId, lessonId }.
 */
export const getLesson = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.get(lessonPath(courseId, moduleId, lessonId));
  return response.data.data;
};

/**
 * Slot state only: { slots: [{ slotId, status, video? }], enrichment }.
 *
 * Used to refresh a resolving video without refetching the whole lesson, which
 * would replace content the reader is partway through.
 */
export const getVideoSlots = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.get(`${lessonPath(courseId, moduleId, lessonId)}/video-slots`);
  return response.data.data;
};

export const generateLesson = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.post(
    lessonPath(courseId, moduleId, lessonId),
    {},
    idempotent()
  );

  // Flat body: { success, message, lessonId, status }
  return response.data;
};

/** `selected` is 1-based to match the option numbering the backend grades against. */
export const submitAnswer = async (courseId, moduleId, lessonId, questionId, selected) => {
  const response = await apiClient.post(
    `${lessonPath(courseId, moduleId, lessonId)}/questions/${questionId}/answer`,
    { selected }
  );

  return response.data.data;
};

export const completeLesson = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.post(`${lessonPath(courseId, moduleId, lessonId)}/complete`);
  return response.data.data;
};
