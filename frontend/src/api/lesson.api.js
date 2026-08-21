import apiClient from './client';

export const generateLesson = async (courseId, lessonId) => {
  const response = await apiClient.post(
    `/v1/course/${courseId}/lessons/${lessonId}`,
    {}, // Empty payload body
    {
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
      },
    }
  );
   
  return response.data; 
};