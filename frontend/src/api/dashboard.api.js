import apiClient from './client';

/**
 * The whole dashboard in one request:
 *   { user, continueLearning, stats, recentCourses }
 *
 * `continueLearning[].resume` is { courseId, moduleId, lessonId, lessonTitle }
 * — everything a deep link back into the learning view needs.
 */
export const getDashboard = async () => {
  const response = await apiClient.get('/v1/dashboard');
  return response.data.data;
};
