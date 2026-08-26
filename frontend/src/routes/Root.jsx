import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';


export const Root = () => {
  const { isLoading } = useAuth();

  if (isLoading) return null;

  return <Navigate to="/dashboard" replace />;
};
