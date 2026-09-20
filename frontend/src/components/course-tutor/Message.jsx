import { MarkdownAnswer } from './MarkdownAnswer';
import { SourceReferences } from './SourceReferences';

/**
 * One turn.
 *
 * The student's own words are rendered as plain text, never as Markdown. They are
 * shown back exactly as typed — a question containing a backtick or an asterisk
 * should not silently change shape on screen.
 */
export const Message = ({ message, courseId }) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary-soft px-3 py-2">
          <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{message.content}</p>
        </div>
      </div>
    );
  }

  const isEmpty = !message.content;

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      {isEmpty && message.streaming ? (
        <ThinkingDots />
      ) : (
        <MarkdownAnswer content={message.content} />
      )}

      {/* A caret while the text is still arriving, so a pause between tokens reads
          as the tutor writing rather than as the answer having ended. */}
      {message.streaming && !isEmpty && (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom" aria-hidden="true" />
      )}

      {message.truncated && !message.streaming && (
        <p className="mt-2 text-xs text-warn-text">
          This answer was cut short. Ask again to get a complete one.
        </p>
      )}

      {!message.streaming && (
        <SourceReferences sources={message.sources} courseId={courseId} />
      )}
    </div>
  );
};

/** The gap before the first token — retrieval and the model's first word. */
const ThinkingDots = () => (
  <div className="flex items-center gap-1 py-1" role="status" aria-label="The tutor is thinking">
    {[0, 150, 300].map((delay) => (
      <span
        key={delay}
        className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint"
        style={{ animationDelay: `${delay}ms` }}
      />
    ))}
  </div>
);
