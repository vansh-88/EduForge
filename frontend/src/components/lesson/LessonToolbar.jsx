import { Spinner } from '../common';

/**
 * Lesson-level actions.
 *
 * PDF export is live; text-to-speech and Hinglish are still planned and ship
 * disabled rather than hidden, so the header's layout is already settled —
 * enabling one means dropping its `comingSoon` flag and passing a handler, with
 * nothing around it moving.
 */
const ACTIONS = [
  {
    key: 'tts',
    label: 'Listen',
    comingSoon: true,
    icon: (
      <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07M18.36 5.64a9 9 0 010 12.72" />
    ),
  },
  {
    key: 'pdf',
    label: 'Export PDF',
    busyLabel: 'Generating PDF…',
    icon: (
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    ),
  },
  {
    key: 'hinglish',
    label: 'Hinglish',
    comingSoon: true,
    icon: <path d="M5 8h14M5 8a7 7 0 007 7 7 7 0 007-7M9 4h2M4 20l4-9 4 9" />,
  },
];

export const LessonToolbar = ({ handlers = {}, busy = {} }) => (
  <div className="flex flex-wrap items-center gap-2">
    {ACTIONS.map((action) => {
      const onClick = handlers[action.key];
      const isBusy = Boolean(busy[action.key]);
      // Disabled while busy too, so a second click cannot start a duplicate
      // export on top of the one already running.
      const disabled = action.comingSoon || !onClick || isBusy;

      return (
        <button
          key={action.key}
          type="button"
          disabled={disabled}
          onClick={onClick}
          title={action.comingSoon ? `${action.label} — coming soon` : action.label}
          aria-busy={isBusy || undefined}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-primary ${
            disabled
              ? 'cursor-not-allowed border-line bg-subtle text-faint'
              : 'border-line-strong bg-surface text-body hover:bg-subtle'
          }`}
        >
          {isBusy ? (
            <Spinner size="sm" className="h-3.5 w-3.5" />
          ) : (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {action.icon}
            </svg>
          )}
          {isBusy ? action.busyLabel ?? 'Working…' : action.label}
        </button>
      );
    })}
  </div>
);
