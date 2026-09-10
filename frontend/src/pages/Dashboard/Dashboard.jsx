import { Link } from 'react-router-dom';
import { useDashboard } from '../../hooks/useDashboard';
import { WelcomeSection } from '../../components/dashboard/WelcomeSection';
import { CourseStats } from '../../components/dashboard/CourseStats';
import { ContinueLearning } from '../../components/dashboard/ContinueLearning';
import { CourseGrid } from '../../components/course/CourseGrid';
import { Button, ErrorState, Skeleton } from '../../components/common';

const StatsSkeleton = () => (
  <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: 4 }, (_, index) => (
      <Skeleton key={index} className="h-20" />
    ))}
  </div>
);

export default function Dashboard() {
  const { data, isLoading, error, refetch } = useDashboard();

  // The whole page comes from one request, so a failure takes the whole page
  // rather than leaving half-rendered sections behind.
  if (error) {
    return (
      <ErrorState
        title="We couldn't load your dashboard"
        message={error.message}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <WelcomeSection user={data?.user} />
        <Link to="/generate">
          <Button>Generate Course</Button>
        </Link>
      </div>

      {isLoading ? <StatsSkeleton /> : <CourseStats stats={data?.stats} />}

      {!isLoading && <ContinueLearning items={data?.continueLearning ?? []} />}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Recent courses</h2>
          <Link to="/courses" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            View all →
          </Link>
        </div>

        <CourseGrid
          courses={data?.recentCourses ?? []}
          isLoading={isLoading}
          onRetry={refetch}
        />
      </section>
    </div>
  );
}
