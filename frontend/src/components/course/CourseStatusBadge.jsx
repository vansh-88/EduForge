// The three in-flight states collapse into one label: a reader cares that the
// course is still building, not which internal phase it's in.
const IN_FLIGHT = ['GENERATING', 'PROCESSING', 'RETRYING'];

export const CourseStatusBadge = ({ status }) => {
  if (!status || status === 'READY') return null;

  if (IN_FLIGHT.includes(status)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-text ring-1 ring-inset ring-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        Generating
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-text ring-1 ring-inset ring-danger">
      Failed
    </span>
  );
};
