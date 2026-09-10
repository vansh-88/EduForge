const STYLES = {
  beginner: 'bg-success-soft text-success-text ring-success',
  intermediate: 'bg-warn-soft text-warn-text ring-warn',
  advanced: 'bg-accent-soft text-accent-text ring-accent',
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
        STYLES[difficulty] ?? 'bg-subtle text-body ring-line-strong'
      }`}
    >
      {LABELS[difficulty] ?? difficulty}
    </span>
  );
};
