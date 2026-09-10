import apiClient from './client';

const BASE = '/v1/users/me';

/** { id, name, email, picture } */
export const getMe = async () => {
  const response = await apiClient.get(BASE);
  return response.data.data;
};

/** `name` is the only editable field — pictures go through the Cloudinary endpoints. */
export const updateMe = async ({ name }) => {
  const response = await apiClient.patch(BASE, { name });
  return response.data.data;
};

/** Aggregated counts: { courses, courseStatus, lessons, quiz }. */
export const getMyStats = async () => {
  const response = await apiClient.get(`${BASE}/stats`);
  return response.data.data;
};
