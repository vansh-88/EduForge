/**
 * Follow-ups offered after an answer.
 *
 * Each is an ordinary question sent into the same conversation — no new endpoint, no
 * mode flag, no server-side concept of an "action". The tutor already has the
 * previous turn in its history, so "Explain that more simply" refers to the answer
 * above it the same way a student's own follow-up would.
 *
 * The prompts are written as a student would say them rather than as commands. The
 * model is being asked to continue a conversation, and an instruction-shaped message
 * ("SIMPLIFY PREVIOUS") reads as a directive that competes with the system prompt
 * instead of a turn that builds on what came before.
 */
const ACTIONS = [
  { key: 'simpler', label: 'Explain simpler', prompt: 'Explain that again, more simply.' },
  { key: 'example', label: 'Give an example', prompt: 'Can you give me a concrete example of that?' },
  { key: 'analogy', label: 'Use an analogy', prompt: 'Can you explain that with an analogy?' },
  { key: 'quiz', label: 'Quiz me', prompt: 'Ask me two questions to check I understood that.' },
  { key: 'hint', label: 'Give a hint', prompt: 'Give me a hint about that without telling me the answer.' },
];

export const QuickActions = ({ onPick, disabled }) => (
  <div className="flex flex-wrap gap-1.5 px-4 pb-2">
    {ACTIONS.map((action) => (
      <button
        key={action.key}
        type="button"
        onClick={() => onPick(action.prompt)}
        disabled={disabled}
        className="rounded-full border border-line px-2.5 py-1 text-[0.6875rem] text-body transition hover:border-line-strong hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:text-faint"
      >
        {action.label}
      </button>
    ))}
  </div>
);
