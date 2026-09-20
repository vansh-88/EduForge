import apiClient from './client';

/**
 * Course Tutor sessions.
 *
 * Only the session lifecycle lives here. Sending a question does NOT: it streams,
 * so it goes through api/stream.js instead — axios in the browser buffers a whole
 * response and cannot read an event stream incrementally.
 *
 * Everything is scoped to a course in the URL, mirroring the backend, which checks
 * that the session really belongs to the course in the path rather than trusting
 * whatever the session says.
 */

/**
 * Starts a conversation.
 *
 * Called on the first question rather than when the panel opens, so browsing a
 * course does not leave an empty session behind on every lesson.
 *
 * @param {string|null} lessonId  null for a course-level conversation
 */
export const createChatSession = async (courseId, lessonId = null) => {
  const { data } = await apiClient.post(`/v1/courses/${courseId}/chat/sessions`, { lessonId });
  return data.data;
};

export const listChatSessions = async (courseId) => {
  const { data } = await apiClient.get(`/v1/courses/${courseId}/chat/sessions`);
  return data.data;
};

/** A session with its full conversation. */
export const getChatSession = async (courseId, sessionId) => {
  const { data } = await apiClient.get(`/v1/courses/${courseId}/chat/sessions/${sessionId}`);
  return data.data;
};

export const deleteChatSession = async (courseId, sessionId) => {
  const { data } = await apiClient.delete(`/v1/courses/${courseId}/chat/sessions/${sessionId}`);
  return data.data;
};
