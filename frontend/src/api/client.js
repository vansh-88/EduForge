import axios from 'axios';

// Create the base instance
const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_BASE_URL}/api`,
});


// Request Interceptor: Attach Auth Token
apiClient.interceptors.request.use(
  (config) => {
    // Hardcoded fake token for the auth stub.
    const token = 'dev-token';
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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