import { useCallback, useEffect, useState } from 'react';

/**
 * A code snippet.
 *
 * No syntax highlighter this round — the seam is the `language` field, which is
 * already carried through from the generator, so adding one later is a change
 * inside this component only.
 */
export const CodeBlock = ({ block }) => {
  const [copied, setCopied] = useState(false);

  // Reset the confirmation on its own; a button stuck on "Copied" reads as
  // broken the next time the reader wants to copy.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(block.text);
      setCopied(true);
    } catch {
      // Clipboard is blocked outside a secure context or without permission.
      // Nothing useful to say — the reader can still select the text.
    }
  }, [block.text]);

  return (
    <figure className="my-6">
      <div className="overflow-hidden rounded-lg border border-inverse-line bg-inverse">
        <div className="flex items-center justify-between border-b border-inverse-line px-4 py-2">
          <span className="font-mono text-xs text-on-inverse-muted">
            {block.language || 'plaintext'}
          </span>

          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-on-inverse-muted transition hover:text-on-inverse focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* The pre scrolls on its own so a long line never widens the page. */}
        <pre className="overflow-x-auto p-4 text-sm leading-6 text-on-inverse">
          <code>{block.text}</code>
        </pre>
      </div>

      {block.caption && (
        <figcaption className="mt-2 text-xs text-muted">{block.caption}</figcaption>
      )}
    </figure>
  );
};
