// The three in-flight states collapse into one label: a reader cares that the
// course is still building, not which internal phase it's in.
const IN_FLIGHT = ['GENERATING', 'PROCESSING', 'RETRYING'];

export const CourseStatusBadge = ({ status }) => {
  if (!status || status === 'READY') return null;

  if (IN_FLIGHT.includes(status)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
        Generating
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
      Failed
    </span>
  );
};
