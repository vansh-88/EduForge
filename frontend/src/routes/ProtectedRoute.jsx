import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();

  // Wait for the authentication check to resolve
  if (isLoading) {
    return <div>Loading...</div>; 
  }

  // Redirect to a placeholder login route if the user isn't authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // If authenticated, render the nested child routes
  return <Outlet />;
};