/**
 * A video slot that has no video yet.
 *
 * The generator emits `{ query, caption }` — a search phrase, not a URL — and
 * nothing resolves it to an actual video until the YouTube phase. So this
 * renders the placeholder rather than pretending: the reader sees what the
 * lesson intends to show them, and when resolution lands only the inside of
 * this frame changes, leaving the page's rhythm intact.
 *
 * Note that the current lesson prompt lists `video` as an allowed block type
 * but never asks for one, so in practice these are rare until that prompt is
 * updated alongside the YouTube work.
 */
export const VideoBlock = ({ block }) => (
  <figure className="my-6">
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-6 text-center">
      <svg
        className="h-10 w-10 text-gray-300"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm6 4.5v7l6-3.5-6-3.5z" />
      </svg>

      <p className="text-sm font-medium text-gray-500">Video coming soon</p>

      <p className="max-w-md text-xs text-gray-400">
        Suggested clip: “{block.query}”
      </p>
    </div>

    {block.caption && (
      <figcaption className="mt-2 text-xs text-gray-500">{block.caption}</figcaption>
    )}
  </figure>
);
