export const useAuth = () => {
  return {
    // Hardcoded fake user for development
    user: { 
      id: 'dev-user-1', 
      name: 'Dev User', 
      email: 'dev@example.com' 
    },
    // Hardcoded auth state
    isAuthenticated: true,
    // Simulating the loading state standard in real auth SDKs
    isLoading: false,
    // No-op functions for now
    login: () => {},
    logout: () => {}
  };
};