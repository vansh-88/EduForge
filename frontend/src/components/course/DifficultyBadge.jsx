const STYLES = {
  beginner: 'bg-green-50 text-green-700 ring-green-600/20',
  intermediate: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  advanced: 'bg-purple-50 text-purple-700 ring-purple-600/20',
};

const LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const DifficultyBadge = ({ difficulty }) => {
  if (!difficulty) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STYLES[difficulty] ?? 'bg-gray-50 text-gray-600 ring-gray-500/20'
      }`}
    >
      {LABELS[difficulty] ?? difficulty}
    </span>
  );
};
