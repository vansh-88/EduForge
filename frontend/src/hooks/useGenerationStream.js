import { useEffect, useRef, useState } from 'react';

// Wire statuses after which nothing further will happen. The backend closes the
// stream on all three, whether they arrive as a live event or as the opening
// snapshot of a generation that already finished.
const TERMINAL_STATUSES = new Set(['ready', 'failed', 'deleted']);

const IDLE = {
  status: null,
  stage: null,
  progress: 0,
  attempt: 0,
  maxAttempts: null,
  lastError: null,
  isDeleted: false,
};

/**
 * Live generation progress for one course or one lesson.
 *
 * Owns only the transport. It never fetches the resource and never decides what
 * a page should render — the page keeps MongoDB as its source of truth and uses
 * `onTerminal` to refetch. That split is why the same hook serves both the
 * course page and the lesson page.
 *
 * Params:
 *   enabled    open the stream only while the resource is actually generating
 *   streamKey  identifies *which* resource; changing it tears down and reopens
 *   subscribe  (handlers) => abortFn — one of the streamers from api/stream.js
 *   onTerminal fired once, with the event the server closes on
 *   onFatal    fired when the stream stopped for good (401/403/404)
 *
 * A transient network error is deliberately not surfaced. fetch-event-source
 * reconnects on its own and the backend replays a snapshot as the first event
 * of every connection, so a blip repairs itself — showing the user an error for
 * it would be noise about something already fixed.
 */
export const useGenerationStream = ({
  enabled,
  streamKey,
  subscribe,
  onTerminal,
  onFatal,
}) => {
  const [state, setState] = useState(IDLE);

  // A new resource must not inherit the previous one's progress bar. Reset in
  // the same render that changed the key, before any stale value is painted.
  const [renderedKey, setRenderedKey] = useState(streamKey);
  if (renderedKey !== streamKey) {
    setRenderedKey(streamKey);
    setState(IDLE);
  }

  // Callbacks live in refs so a page passing inline arrows can't retrigger the
  // subscription. Updated in their own effect, declared before the one below so
  // they are current by the time it subscribes.
  const refs = useRef({ subscribe, onTerminal, onFatal });
  useEffect(() => {
    refs.current = { subscribe, onTerminal, onFatal };
  });

  useEffect(() => {
    if (!enabled) return undefined;

    // Guards the window between the server's last event and our abort taking
    // effect, so a torn-down stream can never write state or fire a callback.
    let closed = false;

    // onTerminal must fire exactly once per stream, and there are two ways to
    // reach it (see below), so the two are deduped against each other.
    let terminalFired = false;

    const fireTerminal = (event) => {
      if (terminalFired) return;
      terminalFired = true;
      refs.current.onTerminal?.(event);
    };

    const abort = refs.current.subscribe({
      onEvent: (event) => {
        if (closed) return;

        setState({
          status: event.status ?? null,
          stage: event.stage ?? null,
          progress: event.progress ?? 0,
          attempt: event.attempt ?? 0,
          maxAttempts: event.maxAttempts ?? null,
          // Only present on terminal failure; never blank a previous message
          // mid-retry.
          lastError: event.lastError ?? null,
          isDeleted: event.type === 'course_deleted',
        });

        // A terminal *status* counts as terminal even when the event type is
        // not. When generation finishes between the page's GET and this
        // subscription, the backend's opening snapshot already says 'ready' and
        // then closes — no completed-event is ever sent. Without this the page
        // would hold a finished progress bar forever, waiting for an event that
        // already happened.
        if (TERMINAL_STATUSES.has(event.status)) fireTerminal(event);
      },

      onTerminal: (event) => {
        if (closed) return;
        fireTerminal(event);
      },

      onFatal: (error) => {
        if (closed) return;
        refs.current.onFatal?.(error);
      },
    });

    return () => {
      closed = true;
      abort();
    };
  }, [enabled, streamKey]);

  return state;
};
