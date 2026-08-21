import apiClient from './client';

export const generateCourse = async ({ topic, difficulty }) => {
  const response = await apiClient.post(
    '/v1/course/generate',
    { topic, difficulty },
    {
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
      },
    }
  );
  
  return response.data; 
};

export const listCourses = async (params = {}) => {
  // Filter out undefined, null, or empty string values so we only send active params
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([_, value]) => value != null && value !== '')
  );

  const response = await apiClient.get('/v1/course', { params: cleanParams });
  
  return {
    courses: response.data.data.courses,
    pagination: response.data.data.pagination,
  };
};

export const getCourse = async (courseId) => {
  const response = await apiClient.get(`/v1/course/${courseId}`);
  return response.data.data.course;
};

export const getModule = async (courseId, moduleId) => {
  const response = await apiClient.get(`/v1/course/${courseId}/modules/${moduleId}`);
  return response.data.data.module;
};

export const retryCourseGeneration = async (courseId) => {
  const response = await apiClient.post(
    `/v1/course/${courseId}/retry`,
    {}, // Empty body
    {
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
      },
    }
  );
  return response.data;
};