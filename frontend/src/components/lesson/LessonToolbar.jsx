/**
 * Lesson-level actions.
 *
 * All three are planned features with no backend behind them yet: text-to-speech,
 * PDF export, and a Hinglish translation toggle. They ship disabled rather than
 * hidden so the header's final layout is settled now — enabling one later means
 * dropping its `comingSoon` flag and wiring `onClick`, with nothing around it
 * moving.
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
    comingSoon: true,
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

export const LessonToolbar = ({ handlers = {} }) => (
  <div className="flex flex-wrap items-center gap-2">
    {ACTIONS.map((action) => {
      const onClick = handlers[action.key];
      const disabled = action.comingSoon || !onClick;

      return (
        <button
          key={action.key}
          type="button"
          disabled={disabled}
          onClick={onClick}
          title={action.comingSoon ? `${action.label} — coming soon` : action.label}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            disabled
              ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
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
          {action.label}
        </button>
      );
    })}
  </div>
);
