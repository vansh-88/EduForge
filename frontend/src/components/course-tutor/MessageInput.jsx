import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_CHARS = 2000; // mirrors CHAT_MESSAGE_MAX_CHARS on the server

/**
 * The question box.
 *
 * Enter sends, Shift+Enter adds a line — the convention every chat interface uses,
 * and the one a student will try without being told. The textarea grows with the
 * question up to a cap, so a long one is readable while typing without the panel
 * losing the conversation above it.
 */
export const MessageInput = ({ onSend, onStop, isStreaming, disabled }) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  // Height follows content. Reset to auto first, or scrollHeight only ever grows.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || isStreaming || disabled) return;
    setValue('');
    onSend(text);
  }, [value, isStreaming, disabled, onSend]);

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="border-t border-line bg-surface px-3 py-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          maxLength={MAX_CHARS}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this lesson…"
          aria-label="Ask the course tutor"
          className="min-h-[2.25rem] flex-1 resize-none rounded-md border border-line-strong bg-canvas px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-subtle"
        />

        {/* One button, two jobs. While an answer is streaming the useful action is
            stopping it, not queueing another question — and a send button that does
            nothing for several seconds reads as broken. */}
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-body transition hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || disabled}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-white transition hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-primary-weak"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
