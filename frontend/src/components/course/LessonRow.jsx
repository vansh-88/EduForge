import { Link } from 'react-router-dom';
import { lessonPath } from '../../utils/paths';

// Lesson lifecycle → the dot shown before the title. PENDING deliberately has
// no dot: "not generated yet" is the normal resting state for most of a course
// and marking it would make a healthy course look full of warnings.
const STATUS_DOT = {
  GENERATING: 'bg-blue-600 animate-pulse',
  PROCESSING: 'bg-blue-600 animate-pulse',
  RETRYING: 'bg-amber-500 animate-pulse',
  FAILED: 'bg-red-500',
};

const CheckIcon = () => (
  <svg
    className="h-4 w-4 text-green-600"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
      clipRule="evenodd"
    />
  </svg>
);

/**
 * One lesson in a module listing.
 *
 * A PENDING lesson is *not* disabled — clicking it is exactly what triggers
 * lazy generation, so it must stay a live link.
 */
export const LessonRow = ({ lesson, courseId, moduleId, completed = false }) => {
  const dot = STATUS_DOT[lesson.status];

  return (
    <Link
      to={lessonPath(courseId, moduleId, lesson.id)}
      className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <span className="w-6 shrink-0 text-xs font-medium tabular-nums text-gray-400">
        {lesson.order + 1}
      </span>

      {/* Fixed-width slot so titles stay aligned whether or not a dot is shown. */}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {completed ? (
          <CheckIcon />
        ) : (
          dot && <span className={`h-2 w-2 rounded-full ${dot}`} />
        )}
      </span>

      <span
        className={`flex-1 text-sm group-hover:text-blue-700 ${
          completed ? 'text-gray-500' : 'text-gray-900'
        }`}
      >
        {lesson.title}
      </span>

      {lesson.status === 'FAILED' && (
        <span className="shrink-0 text-xs font-medium text-red-600">Failed</span>
      )}
    </Link>
  );
};
