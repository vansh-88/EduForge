import { Link } from 'react-router-dom';
import { ProgressBar } from '../common/ProgressBar';
import { formatRelativeDate } from '../../utils/formatDate';
import { coursePath, lessonPath } from '../../utils/paths';

/**
 * The courses most recently opened, each linking straight back to the lesson
 * the user left off on. `resume` can be null if the lesson is unresolvable, in
 * which case the card falls back to the course overview.
 */
const ContinueCard = ({ item }) => {
  const { course, progress, resume, lastVisitedAt } = item;
  const visited = formatRelativeDate(lastVisitedAt);

  const target = resume
    ? lessonPath(resume.courseId, resume.moduleId, resume.lessonId)
    : coursePath(course.id);

  return (
    <Link
      to={target}
      className="group flex flex-col rounded-lg border border-line bg-surface p-5 shadow-sm transition hover:border-line-strong hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
    >
      <h3 className="font-semibold text-ink group-hover:text-primary-text line-clamp-1">
        {course.title || course.query}
      </h3>

      {resume?.lessonTitle && (
        <p className="mt-1 text-sm text-body line-clamp-1">Next: {resume.lessonTitle}</p>
      )}

      <div className="flex-1" />

      <ProgressBar
        className="mt-4"
        value={progress.percentage}
        label={`${progress.completedLessons}/${progress.totalLessons} lessons`}
      />

      <p className="mt-3 flex items-center justify-between text-xs">
        {visited ? <span className="text-faint">Opened {visited}</span> : <span />}
        <span className="font-medium text-primary-text group-hover:text-primary-text">Continue →</span>
      </p>
    </Link>
  );
};

export const ContinueLearning = ({ items = [] }) => {
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-ink mb-3">Continue learning</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <ContinueCard key={item.course.id} item={item} />
        ))}
      </div>
    </section>
  );
};
