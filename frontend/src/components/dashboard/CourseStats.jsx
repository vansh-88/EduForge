const Stat = ({ label, value, hint }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <p className="text-sm text-gray-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
  </div>
);

export const CourseStats = ({ stats }) => {
  if (!stats) return null;

  const { courses, lessons, quiz } = stats;

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Stat label="Courses" value={courses.created} hint={`${courses.completed} completed`} />
      <Stat label="In progress" value={courses.inProgress} />
      <Stat
        label="Lessons done"
        value={lessons.completed}
        hint={lessons.total > 0 ? `of ${lessons.total}` : undefined}
      />
      <Stat
        label="Quiz accuracy"
        value={quiz.answered > 0 ? `${quiz.accuracy}%` : '—'}
        hint={quiz.answered > 0 ? `${quiz.correct}/${quiz.answered} correct` : 'No answers yet'}
      />
    </div>
  );
};
