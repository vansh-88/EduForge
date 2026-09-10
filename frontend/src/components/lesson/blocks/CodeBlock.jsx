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
      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
          <span className="font-mono text-xs text-gray-400">
            {block.language || 'plaintext'}
          </span>

          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-gray-400 transition hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* The pre scrolls on its own so a long line never widens the page. */}
        <pre className="overflow-x-auto p-4 text-sm leading-6 text-gray-100">
          <code>{block.text}</code>
        </pre>
      </div>

      {block.caption && (
        <figcaption className="mt-2 text-xs text-gray-500">{block.caption}</figcaption>
      )}
    </figure>
  );
};
