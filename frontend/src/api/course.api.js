import apiClient from './client';

const BASE = '/v1/courses';

// Every mutation that spends an AI call is idempotent server-side, keyed by this
// header — a fresh key per call is what makes a retry a *new* request rather
// than a replay of the last one.
const idempotent = () => ({ headers: { 'Idempotency-Key': crypto.randomUUID() } });

/** Starts generation. Responds 202 with the placeholder course, not the finished one. */
export const generateCourse = async ({ topic, difficulty }) => {
  const response = await apiClient.post(`${BASE}/generate`, { topic, difficulty }, idempotent());

  // Flat body: { success, message, courseId, status }
  return response.data;
};

export const listCourses = async (params = {}) => {
  // Only send filters that are actually set, so an empty search box doesn't
  // become `search=` and get rejected by the query schema.
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value != null && value !== '')
  );

  const response = await apiClient.get(BASE, { params: cleanParams });

  // { courses, pagination } — each course carries progress, difficulty and counts.
  return response.data.data;
};

/** Returns { course, progress }. Modules arrive with their lessons already nested and ordered. */
export const getCourse = async (courseId) => {
  const response = await apiClient.get(`${BASE}/${courseId}`);
  return response.data.data;
};

export const retryCourseGeneration = async (courseId) => {
  const response = await apiClient.post(`${BASE}/${courseId}/retry`, {}, idempotent());
  return response.data;
};

export const deleteCourse = async (courseId) => {
  const response = await apiClient.delete(`${BASE}/${courseId}`);
  return response.data.data;
};
