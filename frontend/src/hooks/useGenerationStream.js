import { useEffect, useRef, useState } from 'react';

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
 *   onEvent    every event, as it arrives; use this for updates that are not the
 *              aggregate's own lifecycle
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
  onEvent,
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
  const refs = useRef({ subscribe, onEvent, onTerminal, onFatal });
  useEffect(() => {
    refs.current = { subscribe, onEvent, onTerminal, onFatal };
  });

  useEffect(() => {
    if (!enabled) return undefined;

    // Guards the window between the server's last event and our abort taking
    // effect, so a torn-down stream can never write state or fire a callback.
    let closed = false;

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

        // Note there is deliberately no "terminal status" shortcut here.
        //
        // One used to exist, to catch a generation that finished between the
        // page's fetch and this subscription — the opening snapshot says
        // 'ready' and the server closes without ever publishing a completed
        // event. That inference broke once enrichment was added: a lesson is
        // 'ready' the moment its text is written, while its video slots keep
        // resolving and publishing onto this same stream, so treating 'ready'
        // as terminal ended the stream early and forced a needless refetch on
        // every lesson that had a video pending.
        //
        // api/stream.js now reports the server's own close as terminal instead,
        // which is the authoritative signal rather than a guess at one.
        refs.current.onEvent?.(event);
      },

      // Already deduped by api/stream.js, which owns the once-per-stream rule.
      onTerminal: (event) => {
        if (closed) return;
        refs.current.onTerminal?.(event);
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
