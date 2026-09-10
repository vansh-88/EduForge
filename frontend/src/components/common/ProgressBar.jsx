export const ProgressBar = ({ value = 0, label, className = '' }) => {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={className}>
      {label && (
        <div className="flex justify-between text-xs text-muted mb-1">
          <span>{label}</span>
          <span>{clamped}%</span>
        </div>
      )}
      <div
        className="h-1.5 w-full rounded-full bg-subtle overflow-hidden"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};
