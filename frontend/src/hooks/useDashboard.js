import { useApiResource } from './useApiResource';
import { getDashboard } from '../api/dashboard.api';

/**
 * The dashboard payload: { user, continueLearning, stats, recentCourses }.
 * Fetched once on mount — there are no parameters, so it never refetches on
 * its own.
 */
export const useDashboard = () => {
  const { data, isLoading, error, refetch } = useApiResource(() => getDashboard());

  return { data, isLoading, error, refetch };
};
