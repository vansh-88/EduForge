import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCourses } from '../../hooks/useCourses';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Button, Input } from '../../components/common';
import { CourseGrid } from '../../components/course/CourseGrid';

// Mirrors listCoursesQuerySchema. The three in-flight statuses are offered as
// one "Generating" choice because that is how the rest of the UI presents them;
// PROCESSING and RETRYING are internal phases, not something to filter on.
const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Ready', value: 'READY' },
  { label: 'Generating', value: 'GENERATING' },
  { label: 'Failed', value: 'FAILED' },
];

const DIFFICULTY_OPTIONS = [
  { label: 'All levels', value: '' },
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Advanced', value: 'advanced' },
];

const selectClass =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export default function Courses() {
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [page, setPage] = useState(1);

  // The box stays responsive; the request waits for a pause in typing.
  const search = useDebouncedValue(searchInput, 300);

  // Any filter change invalidates the current page number — page 3 of the old
  // result set is meaningless against the new one, and often out of range. Done
  // in the handlers rather than an effect so the reset is part of the event that
  // caused it, instead of a render reacting to its own state.
  const applyFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  const { courses, pagination, isLoading, error, refetch } = useCourses({
    page,
    search,
    status,
    difficulty,
  });

  const hasFilters = Boolean(search || status || difficulty);

  return (
    <div className="mt-8 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Your courses</h1>
        <Button onClick={() => navigate('/generate')}>New course</Button>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="min-w-60 flex-1">
          <Input
            type="search"
            placeholder="Search by title or topic…"
            value={searchInput}
            onChange={applyFilter(setSearchInput)}
          />
        </div>

        <select
          className={selectClass}
          value={status}
          onChange={applyFilter(setStatus)}
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          value={difficulty}
          onChange={applyFilter(setDifficulty)}
          aria-label="Filter by difficulty"
        >
          {DIFFICULTY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <CourseGrid
          courses={courses}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
          skeletonCount={6}
          // With filters applied, an empty grid means "no matches", not "no
          // courses" — offering to generate a first course would be wrong.
          emptyTitle={
            hasFilters ? 'No courses match those filters.' : "You haven't created a course yet."
          }
          emptyDescription={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Generate your first course and start learning.'
          }
        />
      </div>

      {pagination && pagination.totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-4">
          <Button
            variant="secondary"
            disabled={!pagination.hasPreviousPage}
            onClick={() => setPage((current) => current - 1)}
          >
            ← Previous
          </Button>

          <span className="text-sm text-gray-500">
            Page {pagination.page} of {pagination.totalPages}
          </span>

          <Button
            variant="secondary"
            disabled={!pagination.hasNextPage}
            onClick={() => setPage((current) => current + 1)}
          >
            Next →
          </Button>
        </nav>
      )}
    </div>
  );
}
