import { useEffect, useRef } from 'react';
import { Message } from './Message';

const STARTERS = [
  'Explain this lesson simply',
  'Give me a real-world example',
  'What should I understand first?',
];

/**
 * The conversation, pinned to the newest message.
 *
 * Auto-scroll is deliberately conditional. Following the stream is right while the
 * reader is at the bottom, and wrong the moment they scroll up to re-read something
 * — yanking them back down mid-sentence is worse than not following at all. So it
 * only scrolls when they are already near the end.
 */
export const MessageList = ({ messages, courseId, onPick, isStreaming }) => {
  const endRef = useRef(null);
  const scrollerRef = useRef(null);
  const pinnedRef = useRef(true);

  // Recomputed on every scroll rather than on render, so the decision reflects where
  // the reader is now, not where they were when the last token arrived.
  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center px-4 py-6">
        <p className="text-sm text-muted">
          Ask about anything in this lesson. Answers are grounded in your course.
        </p>

        <div className="mt-3 flex flex-col items-start gap-1.5">
          {STARTERS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPick(prompt)}
              disabled={isStreaming}
              className="rounded-md border border-line px-2.5 py-1.5 text-left text-xs text-body transition hover:border-line-strong hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:text-faint"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
    >
      {messages.map((message) => (
        <Message key={message.id} message={message} courseId={courseId} />
      ))}
      <div ref={endRef} />
    </div>
  );
};
