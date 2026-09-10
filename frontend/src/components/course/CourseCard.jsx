import { Link } from 'react-router-dom';
import { DifficultyBadge } from './DifficultyBadge';
import { CourseStatusBadge } from './CourseStatusBadge';
import { ProgressBar } from '../common/ProgressBar';
import { formatRelativeDate } from '../../utils/formatDate';
import { coursePath } from '../../utils/paths';

/**
 * One course, wherever a course is listed.
 *
 * The dashboard serializes ids as `id` while the course list returns raw
 * documents with `_id`, so both are accepted rather than normalizing at every
 * call site. Title is null until generation produces one — the user's original
 * prompt stands in until then.
 */
export const CourseCard = ({ course }) => {
  const courseId = course.id ?? course._id;
  const progress = course.progress;
  const createdAt = formatRelativeDate(course.createdAt);

  return (
    <Link
      to={coursePath(courseId)}
      className="group flex flex-col rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 line-clamp-2">
          {course.title || course.query}
        </h3>
        <CourseStatusBadge status={course.status} />
      </div>

      {course.description && (
        <p className="mt-2 text-sm text-gray-600 line-clamp-2">{course.description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DifficultyBadge difficulty={course.difficulty} />
        {course.status === 'READY' && (
          <span className="text-xs text-gray-500">
            {course.moduleCount} {course.moduleCount === 1 ? 'Module' : 'Modules'} ·{' '}
            {course.lessonCount} {course.lessonCount === 1 ? 'Lesson' : 'Lessons'}
          </span>
        )}
      </div>

      {/* Pushes the footer down so cards in a row line up regardless of description length. */}
      <div className="flex-1" />

      {progress?.totalLessons > 0 && (
        <ProgressBar
          className="mt-4"
          value={progress.percentage}
          label={`${progress.completedLessons}/${progress.totalLessons} lessons`}
        />
      )}

      {createdAt && <p className="mt-3 text-xs text-gray-400">Created {createdAt}</p>}
    </Link>
  );
};
