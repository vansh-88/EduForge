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

/**
 * Deletes every course, lesson, and progress record this account owns.
 *
 * Note it does NOT delete the Auth0 identity — signing in again provisions a
 * fresh, empty account. The response carries a `note` saying so.
 */
export const deleteMe = async () => {
  const response = await apiClient.delete(BASE);
  return response.data.data;
};

/* -------------------------------------------------------------------------- */
/* Profile picture                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Uploads an avatar straight from the browser to Cloudinary.
 *
 * Three steps, and the middle one deliberately bypasses `apiClient`: it targets
 * Cloudinary rather than our API, so it must not carry the Auth0 bearer token.
 *
 *   1. ask our server to sign an upload — the server pins `public_id` to the
 *      authenticated user, so this cannot be aimed at anyone else's avatar
 *   2. POST the file to Cloudinary with that signature
 *   3. ask our server to verify what actually landed and record it
 *
 * Step 3 is not a formality. With direct upload the file reaches Cloudinary
 * before our server ever sees it, so validation is necessarily after the fact —
 * the server re-reads the asset, and destroys it if it is oversized or not an
 * image. A caller that skips confirm leaves an unverified file in the account
 * and no updated user record.
 */
export const uploadAvatar = async (file, { signal } = {}) => {
  const signatureResponse = await apiClient.post(`${BASE}/picture/signature`, null, { signal });
  const { cloudName, apiKey, signature, timestamp, public_id, overwrite, invalidate, limits } =
    signatureResponse.data.data;

  // Fail before spending the upload on a file the server will only reject.
  if (limits?.maxBytes && file.size > limits.maxBytes) {
    const mb = Math.round(limits.maxBytes / (1024 * 1024));
    throw new Error(`Image must be smaller than ${mb}MB`);
  }

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('public_id', public_id);
  // Must match the signed params exactly, in both value and presence, or
  // Cloudinary rejects the signature.
  form.append('overwrite', String(overwrite));
  form.append('invalidate', String(invalidate));
  form.append('signature', signature);

  const upload = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
    signal,
  });

  if (!upload.ok) {
    const detail = await upload.json().catch(() => null);
    throw new Error(detail?.error?.message || 'Upload failed. Please try another image.');
  }

  // The updated user, only after the server has verified the asset.
  const confirmed = await apiClient.post(`${BASE}/picture/confirm`, null, { signal });
  return confirmed.data.data;
};

export const deleteAvatar = async () => {
  const response = await apiClient.delete(`${BASE}/picture`);
  return response.data.data;
};
