import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../common';

const RATES = [1, 1.25, 1.5, 0.75];

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const Icon = ({ children }) => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/**
 * Plays a lesson aloud, section by section.
 *
 * One `<audio>` element for the whole lesson rather than one per section: the
 * browser only ever plays one at a time, and swapping `src` on a single element
 * is what makes "move to the next section" a two-line operation instead of a
 * coordination problem between several elements.
 *
 * The hard part is that the sections arrive WHILE the reader is listening —
 * synthesis takes roughly twelve seconds each, so section four may not exist
 * when section three ends. Running off the end is therefore a normal state, not
 * an error: the player parks, says so, and resumes by itself when the next
 * section lands.
 */
export const AudioPlayer = ({ segments, isGenerating, totalExpected, onClose }) => {
  const audioRef = useRef(null);

  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [showList, setShowList] = useState(false);

  // `segments` carries every section, including ones not yet recorded, so the
  // track list can show what is still coming. Only a READY one with a URL is
  // actually playable — the rest are placeholders the player parks on.
  const atIndex = segments[index] ?? null;
  const current = atIndex?.status === 'READY' && atIndex.audioUrl ? atIndex : null;

  // True when the reader has listened past everything recorded so far. Not an
  // error state: either the section exists but isn't recorded yet, or the worker
  // is still producing — and the load effect below resumes on its own when it
  // lands.
  const waitingForNext = isPlaying && !current && (isGenerating || Boolean(atIndex));

  /**
   * Whether playback should continue into the next section.
   *
   * Held in a ref because it is read inside the `ended` handler, which is
   * attached once — reading state there would capture whatever `isPlaying` was
   * when the listener was created.
   */
  const shouldContinueRef = useRef(false);

  const play = useCallback(async () => {
    const el = audioRef.current;
    if (!el || !el.src) return;
    try {
      await el.play();
      setIsPlaying(true);
      shouldContinueRef.current = true;
    } catch {
      // Autoplay was refused, or the source was swapped mid-play. Neither is
      // worth an error message — the reader still has a play button.
      setIsPlaying(false);
    }
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
    shouldContinueRef.current = false;
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const goTo = useCallback(
    (next) => {
      if (next < 0 || next >= segments.length) return;
      setIndex(next);
      setElapsed(0);
    },
    [segments.length]
  );

  // Load the current section into the element whenever it changes, and keep
  // playing across the boundary if the reader was already listening.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current?.audioUrl) return;

    // Guard against re-setting the same source, which would restart the section
    // every time an unrelated re-render happened.
    if (el.src === current.audioUrl) return;

    el.src = current.audioUrl;
    el.playbackRate = rate;
    setElapsed(0);

    if (shouldContinueRef.current) play();
    // `rate` is applied here but deliberately not a dependency: changing speed
    // must not reload the section and lose the reader's position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.audioUrl, play]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  }, [rate]);

  /**
   * Live values for the `ended` handler, which is created once and would
   * otherwise close over whatever they were at mount.
   */
  const liveRef = useRef({ index: 0, total: 0, isGenerating: false });
  useEffect(() => {
    liveRef.current = { index, total: segments.length, isGenerating };
  });

  /**
   * Advance when a section finishes.
   *
   * If the next one does not exist yet, `index` still moves past the end — that
   * is what puts the player into `waitingForNext`, and it means the load effect
   * above fires by itself when the section finally arrives. Stopping at the last
   * available section instead would need polling to notice the new one.
   *
   * The exception is the true end: nothing left and nothing coming, so stop
   * rather than park on a spinner that will never resolve.
   */
  const handleEnded = useCallback(() => {
    const { index: at, total, isGenerating: stillComing } = liveRef.current;
    const next = at + 1;

    setIndex(next);
    setElapsed(0);

    if (next >= total && !stillComing) {
      setIsPlaying(false);
      shouldContinueRef.current = false;
    }
  }, []);

  const seek = useCallback((event) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const value = Number(event.target.value);
    el.currentTime = value;
    setElapsed(value);
  }, []);

  const cycleRate = useCallback(() => {
    setRate((previous) => RATES[(RATES.indexOf(previous) + 1) % RATES.length]);
  }, []);

  const label = useMemo(() => {
    if (waitingForNext) return `Generating section ${index + 1}…`;
    if (current?.title) return current.title;
    if (current) return `Section ${index + 1}`;
    return 'Finished';
  }, [waitingForNext, current, index]);

  const knownTotal = Math.max(totalExpected ?? 0, segments.length);

  return (
    <div className="sticky bottom-0 z-20 mt-10 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={handleEnded}
        preload="auto"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          title="Previous section"
          aria-label="Previous section"
          className="rounded-md p-1.5 text-body transition hover:bg-subtle disabled:cursor-not-allowed disabled:text-faint"
        >
          <Icon><path d="M19 20L9 12l10-8v16zM5 19V5" /></Icon>
        </button>

        <button
          type="button"
          onClick={toggle}
          disabled={!current}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="rounded-full bg-primary p-2.5 text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary-weak"
        >
          {waitingForNext ? (
            <Spinner size="sm" className="h-4 w-4" />
          ) : isPlaying && current ? (
            <Icon><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></Icon>
          ) : (
            <Icon><path d="M5 3l14 9-14 9V3z" /></Icon>
          )}
        </button>

        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index >= segments.length - 1}
          title="Next section"
          aria-label="Next section"
          className="rounded-md p-1.5 text-body transition hover:bg-subtle disabled:cursor-not-allowed disabled:text-faint"
        >
          <Icon><path d="M5 4l10 8-10 8V4zM19 5v14" /></Icon>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-xs font-medium text-ink">{label}</p>
            <p className="shrink-0 text-[11px] tabular-nums text-muted">
              {formatTime(elapsed)} / {formatTime(duration)}
              {knownTotal > 0 && (
                <span className="ml-2">
                  {Math.min(index + 1, knownTotal)} of {knownTotal}
                  {isGenerating && '+'}
                </span>
              )}
            </p>
          </div>

          <input
            type="range"
            min={0}
            max={Number.isFinite(duration) && duration > 0 ? duration : 0}
            value={elapsed}
            onChange={seek}
            disabled={!current}
            aria-label="Seek within this section"
            className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-subtle accent-primary disabled:cursor-not-allowed"
          />
        </div>

        <button
          type="button"
          onClick={cycleRate}
          title="Playback speed"
          className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-medium tabular-nums text-body transition hover:bg-subtle"
        >
          {rate}×
        </button>

        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          title="Sections"
          aria-label="Sections"
          aria-expanded={showList}
          className="shrink-0 rounded-md p-1.5 text-body transition hover:bg-subtle"
        >
          <Icon><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Icon>
        </button>

        {onClose && (
          <button
            type="button"
            onClick={() => { pause(); onClose(); }}
            title="Close player"
            aria-label="Close player"
            className="shrink-0 rounded-md p-1.5 text-muted transition hover:bg-subtle hover:text-body"
          >
            <Icon><path d="M18 6L6 18M6 6l12 12" /></Icon>
          </button>
        )}
      </div>

      {showList && (
        <ol className="mt-3 max-h-48 space-y-0.5 overflow-y-auto border-t border-line pt-2">
          {segments.map((segment, i) => (
            <li key={segment.segmentId ?? segment.sequence}>
              <button
                type="button"
                onClick={() => goTo(i)}
                disabled={segment.status !== 'READY'}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition ${
                  i === index
                    ? 'bg-primary-soft font-medium text-primary-text'
                    : segment.status === 'READY'
                      ? 'text-body hover:bg-subtle'
                      : 'cursor-not-allowed text-faint'
                }`}
              >
                <span className="w-4 shrink-0 tabular-nums">{i + 1}</span>
                <span className="truncate">{segment.title ?? `Section ${i + 1}`}</span>
                {segment.status !== 'READY' && <Spinner size="sm" className="ml-auto h-3 w-3" />}
                {segment.status === 'READY' && segment.durationSeconds != null && (
                  <span className="ml-auto shrink-0 tabular-nums text-muted">
                    {formatTime(segment.durationSeconds)}
                  </span>
                )}
              </button>
            </li>
          ))}

          {isGenerating && (
            <li className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted">
              <Spinner size="sm" className="h-3 w-3" />
              More sections on the way…
            </li>
          )}
        </ol>
      )}
    </div>
  );
};
