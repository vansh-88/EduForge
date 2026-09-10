import { useNavigate } from 'react-router-dom';
import { CourseCard } from './CourseCard';
import { EmptyState, ErrorState, Skeleton } from '../common';

const CourseCardSkeleton = () => (
  <div className="rounded-lg border border-gray-200 bg-white p-5">
    <Skeleton className="h-5 w-3/4" />
    <Skeleton className="mt-3 h-4 w-full" />
    <Skeleton className="mt-2 h-4 w-5/6" />
    <Skeleton className="mt-4 h-5 w-24" />
  </div>
);

/**
 * Owns all four data states so pages don't repeat them.
 */
export const CourseGrid = ({
  courses = [],
  isLoading = false,
  error = null,
  onRetry,
  skeletonCount = 3,
  emptyTitle = "You haven't created a course yet.",
  emptyDescription = 'Generate your first course and start learning.',
}) => {
  const navigate = useNavigate();

  const gridClass = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';

  if (isLoading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: skeletonCount }, (_, index) => (
          <CourseCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="We couldn't load your courses"
        message={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (courses.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel="Generate Your First Course"
        onAction={() => navigate('/generate')}
      />
    );
  }

  return (
    <div className={gridClass}>
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </div>
  );
};
