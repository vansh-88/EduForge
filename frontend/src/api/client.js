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
    let errorMessage = 'Network error or server is unreachable';

    if (error.response) {
      errorMessage = error.response.data?.error || `Server error: ${error.response.status}`;
    }

    return Promise.reject(new Error(errorMessage));
  }
);

export default apiClient;