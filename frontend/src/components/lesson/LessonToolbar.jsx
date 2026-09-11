import { Spinner } from '../common';

/**
 * Lesson-level actions.
 *
 * `handlers` / `busy` / `active` are keyed maps, so adding an action is a row in
 * ACTIONS plus an entry in each — no change to the markup below.
 */
const ACTIONS = [
  {
    key: 'tts',
    label: 'Listen',
    busyLabel: 'Preparing audio…',
    // Also a toggle: once audio exists the button shows and hides the player.
    activeLabel: 'Hide player',
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
    busyLabel: 'Translating…',
    // A toggle, not a one-shot: once a translation exists the button switches the
    // reader between languages, so it needs a pressed state to say which one is
    // showing. `activeLabel` is what it reads as while Hinglish is on screen.
    activeLabel: 'English',
    icon: <path d="M5 8h14M5 8a7 7 0 007 7 7 7 0 007-7M9 4h2M4 20l4-9 4 9" />,
  },
];

export const LessonToolbar = ({ handlers = {}, busy = {}, active = {} }) => (
  <div className="flex flex-wrap items-center gap-2">
    {ACTIONS.map((action) => {
      const onClick = handlers[action.key];
      const isBusy = Boolean(busy[action.key]);
      const isActive = Boolean(active[action.key]);
      // Disabled while busy too, so a second click cannot start a duplicate
      // export on top of the one already running.
      const disabled = action.comingSoon || !onClick || isBusy;

      const label = isBusy
        ? action.busyLabel ?? 'Working…'
        : isActive
          ? action.activeLabel ?? action.label
          : action.label;

      return (
        <button
          key={action.key}
          type="button"
          disabled={disabled}
          onClick={onClick}
          title={action.comingSoon ? `${action.label} — coming soon` : label}
          aria-busy={isBusy || undefined}
          // Only meaningful for the actions that toggle; omitted entirely on the
          // others so a screen reader does not announce a pressed state for a
          // button that has none.
          aria-pressed={action.activeLabel ? isActive : undefined}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-primary ${
            disabled
              ? 'cursor-not-allowed border-line bg-subtle text-faint'
              : isActive
                ? 'border-primary bg-primary-soft text-primary-text hover:bg-subtle'
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
          {label}
        </button>
      );
    })}
  </div>
);
