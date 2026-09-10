import { Spinner } from '../../common';

/**
 * A video slot, in whatever state resolution has reached.
 *
 * The generator emits search intent, not a URL, and a separate worker resolves
 * it after the lesson is already readable. So this block is genuinely a state
 * machine rather than an embed:
 *
 *   PENDING/RESOLVING → a placeholder, sized like the eventual player so the
 *                       page does not jump when the video arrives
 *   READY             → the embed
 *   UNAVAILABLE/FAILED→ nothing at all
 *
 * Rendering nothing on failure is deliberate. A video is an optional aid; an
 * apology for a missing one is worse than its absence, and would draw attention
 * to a gap the reader would otherwise never notice.
 */
export const VideoBlock = ({ block }) => {
  const { status, video, caption } = block;

  if (status === 'UNAVAILABLE' || status === 'FAILED') return null;

  if (status === 'READY' && video?.videoId) {
    return (
      <figure className="my-6">
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-inverse">
          <iframe
            // nocookie so a lesson page does not set advertising cookies on a
            // reader who never pressed play.
            src={`https://www.youtube-nocookie.com/embed/${video.videoId}?rel=0`}
            title={video.title || caption || 'Lesson video'}
            className="h-full w-full"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>

        <figcaption className="mt-2 text-xs text-muted">
          {caption && <span className="block text-body">{caption}</span>}
          {video.title && (
            <span className="block">
              {video.title}
              {video.channelTitle && ` · ${video.channelTitle}`}
            </span>
          )}
        </figcaption>
      </figure>
    );
  }

  // Still resolving. Occupies the same box the player will, so the surrounding
  // text does not reflow when it resolves.
  return (
    <figure className="my-6">
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-line-strong bg-subtle px-6 text-center">
        <Spinner size="sm" className="text-faint" />
        <p className="text-sm font-medium text-muted">Finding a relevant video…</p>
        <p className="text-xs text-faint">
          The lesson is ready to read — this will appear on its own.
        </p>
      </div>

      {caption && (
        <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>
      )}
    </figure>
  );
};
