import { useApiResource } from './useApiResource';
import { listCourses } from '../api/course.api';

/**
 * A page of the reader's course library.
 *
 * Filters are passed as separate scalars rather than an object because
 * useApiResource compares deps by joining them — an object would be a new
 * reference every render and refetch forever.
 */
export const useCourses = ({ page = 1, limit = 12, search, status, difficulty }) => {
  const { data, isLoading, error, refetch } = useApiResource(
    () => listCourses({ page, limit, search, status, difficulty }),
    [page, limit, search ?? '', status ?? '', difficulty ?? '']
  );

  return {
    courses: data?.courses ?? [],
    pagination: data?.pagination ?? null,
    isLoading,
    error,
    refetch,
  };
};
