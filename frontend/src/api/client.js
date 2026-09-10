import axios from 'axios';
import { getToken } from './authToken';

// Create the base instance
const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_BASE_URL}/api`,
});


// Request Interceptor: Attach Auth Token
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // No session yet — let the request go out without a token. Every caller
      // of this client sits behind ProtectedRoute, so this only happens in the
      // brief window before Auth0 finishes its initial load.
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);


// Response Interceptor: Normalize Errors
apiClient.interceptors.response.use(
  (response) => {
    // since the backend shape is inconsistent, passs the raw response through and let the individual API functions handle their own data unwrapping.
    return response;
  },
  (error) => {
    if (!error.response) {
      const networkError = new Error('Network error or server is unreachable');
      networkError.status = null;
      return Promise.reject(networkError);
    }

    const { status, data } = error.response;
    const normalized = new Error(data?.error || `Server error: ${status}`);

    // Carried through so callers can branch without re-parsing the response:
    // `code` distinguishes RATE_LIMITED / LESSON_NOT_READY etc., `status`
    // separates a missing course (404) from a real failure, and `issues` holds
    // the per-field Zod messages on a 400.
    normalized.status = status;
    normalized.code = data?.code ?? null;
    normalized.issues = data?.issues ?? null;

    return Promise.reject(normalized);
  }
);

export default apiClient;