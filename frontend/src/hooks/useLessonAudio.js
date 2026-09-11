import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGenerationStream } from './useGenerationStream';
import { requestAudio, getAudio } from '../api/lesson.api';
import { streamLessonAudio } from '../api/stream';

/**
 * Audio already fetched this session, keyed by lesson id.
 *
 * Same reasoning as the translation cache: `useApiResource` has no cross-mount
 * cache, so without this, navigating away and back would re-request a document
 * that cannot have changed. Only fully READY audio is cached — a partial run is
 * still moving, so it must be re-read rather than replayed from memory.
 */
const cache = new Map();

// Statuses that mean a job is running and the stream is worth holding open.
const WATCHABLE = new Set(['PENDING', 'GENERATING', 'PROCESSING', 'RETRYING']);

/**
 * Spoken audio for the current lesson, generated on demand.
 *
 * The defining constraint: synthesis takes roughly twelve seconds per section,
 * so a lesson is minutes of work. Waiting for all of it before playing anything
 * would make the feature unusable, which is why the backend emits each section as
 * it lands and this hook exposes a segment list that fills in over time rather
 * than a single file that appears at the end.
 *
 *   click → cached? play it
 *         → POST → 200? play it
 *                → 202 → watch SSE → each audio_segment_ready appends a playable
 *                        section, and playback can start on the first one
 */
export const useLessonAudio = ({ courseId, moduleId, lessonId }) => {
  const [segments, setSegments] = useState([]);
  const [status, setStatus] = useState('NOT_REQUESTED');
  const [error, setError] = useState(null);
  // Carried alongside the message so the page can tell a retryable failure from
  // one where retrying now is guaranteed to fail again (rate limit, spent quota).
  const [errorCode, setErrorCode] = useState(null);
  const [isRequesting, setIsRequesting] = useState(false);

  // Reset in the same render that changed the lesson, before the previous
  // lesson's audio is painted against new content. Same shape as
  // useGenerationStream's key reset.
  const [renderedLessonId, setRenderedLessonId] = useState(lessonId);
  if (renderedLessonId !== lessonId) {
    setRenderedLessonId(lessonId);
    const cached = cache.get(lessonId);
    setSegments(cached ?? []);
    setStatus(cached ? 'READY' : 'NOT_REQUESTED');
    setError(null);
    setErrorCode(null);
  }

  // Guards every async continuation against writing into a lesson the reader has
  // already navigated away from.
  const activeLessonRef = useRef(lessonId);
  useEffect(() => {
    activeLessonRef.current = lessonId;
  }, [lessonId]);

  /**
   * Merges one section into the list without disturbing the others.
   *
   * By sequence rather than by array position, because sections can be absent
   * (a fresh run has none yet) and the event for section 3 can in principle
   * arrive before the list containing section 3 does.
   */
  const upsertSegment = useCallback((incoming) => {
    setSegments((previous) => {
      const next = [...previous];
      const at = next.findIndex((segment) => segment.sequence === incoming.sequence);

      if (at === -1) next.push(incoming);
      else next[at] = { ...next[at], ...incoming };

      return next.sort((a, b) => a.sequence - b.sequence);
    });
  }, []);

  const load = useCallback(async () => {
    const requestedLesson = activeLessonRef.current;
    try {
      const result = await getAudio(courseId, moduleId, lessonId);
      if (activeLessonRef.current !== requestedLesson) return;

      if (result.status === 'STALE') {
        setStatus('STALE');
        setError('This lesson changed after its audio was made. Generate it again.');
        return;
      }

      setSegments(result.segments ?? []);
      setStatus(result.status);

      // Only a finished run is worth remembering; a partial one is still moving.
      if (result.status === 'READY') cache.set(lessonId, result.segments ?? []);
    } catch (err) {
      if (activeLessonRef.current !== requestedLesson) return;
      setStatus('FAILED');
      setError(err.message);
      setErrorCode(err.code ?? null);
    }
  }, [courseId, moduleId, lessonId]);

  /**
   * The in-flight guard, a ref rather than state because `start` is called from a
   * click handler and would otherwise close over a stale value — two fast clicks
   * would both POST, each with its own idempotency key.
   */
  const inFlightRef = useRef(false);

  const start = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const requestedLesson = activeLessonRef.current;

    setIsRequesting(true);
    setError(null);
    setErrorCode(null);

    try {
      const result = await requestAudio(courseId, moduleId, lessonId);
      if (activeLessonRef.current !== requestedLesson) return;

      // Both 200 and 202 carry whatever sections already exist, so a reader who
      // reloads mid-run resumes with the playable ones rather than from silence.
      if (result.segments) setSegments(result.segments);
      setStatus(result.status ?? 'GENERATING');

      if (result.status === 'READY' && result.segments) {
        cache.set(lessonId, result.segments);
      }
    } catch (err) {
      if (activeLessonRef.current !== requestedLesson) return;
      setStatus('FAILED');
      setError(err.message);
      setErrorCode(err.code ?? null);
    } finally {
      inFlightRef.current = false;
      if (activeLessonRef.current === requestedLesson) setIsRequesting(false);
    }
  }, [courseId, moduleId, lessonId]);

  /** What the Listen button calls. Safe to call repeatedly. */
  const request = useCallback(() => {
    if (cache.has(lessonId)) return;
    if (WATCHABLE.has(status)) return;
    return start();
  }, [lessonId, status, start]);

  /** Skips the guards in `request`, which would refuse on the FAILED status it clears. */
  const retry = useCallback(() => {
    cache.delete(lessonId);
    setSegments([]);
    setStatus('NOT_REQUESTED');
    setError(null);
    setErrorCode(null);
    return start();
  }, [lessonId, start]);

  const subscribe = useCallback(
    (handlers) => streamLessonAudio(courseId, moduleId, lessonId, handlers),
    [courseId, moduleId, lessonId]
  );

  const onEvent = useCallback(
    (event) => {
      if (event.type !== 'audio_segment_ready') return;

      // The URL rides on the event rather than being fetched afterwards.
      // Unlike a video slot, a segment is immutable once READY — so the event
      // cannot disagree with the database, and making the player wait for a round
      // trip before sound comes out would undo the point of segmenting at all.
      upsertSegment({
        segmentId: event.segmentId,
        sequence: event.sequence,
        title: event.title ?? null,
        status: 'READY',
        audioUrl: event.audioUrl,
        durationSeconds: event.durationSeconds ?? null,
      });
    },
    [upsertSegment]
  );

  const onTerminal = useCallback(
    (event) => {
      if (event.type === 'course_deleted') return;

      if (event.type === 'audio_failed') {
        setStatus('FAILED');
        setError(event.lastError || 'Audio generation failed. You can try again.');
        // Sections already finished stay playable — a partial reading beats none.
        return;
      }

      // 'audio_completed', or 'stream_closed' meaning the server judged from the
      // database that nothing more is coming. Re-read to pick up the final
      // ordering, durations, and anything a missed event left out.
      load();
    },
    [load]
  );

  const onFatal = useCallback((err) => {
    setStatus('FAILED');
    setError(err.message);
  }, []);

  const generation = useGenerationStream({
    enabled: WATCHABLE.has(status),
    streamKey: lessonId,
    subscribe,
    onEvent,
    onTerminal,
    onFatal,
  });

  const readySegments = useMemo(
    () => segments.filter((segment) => segment.status === 'READY' && segment.audioUrl),
    [segments]
  );

  return useMemo(
    () => ({
      segments,
      readySegments,
      status,
      error,
      errorCode,
      generation,
      // True from the click until the first section can be played — the window in
      // which there is genuinely nothing to listen to.
      isPreparing: (isRequesting || WATCHABLE.has(status)) && readySegments.length === 0,
      // Distinct from isPreparing: audio is playable AND more is still coming.
      isGenerating: WATCHABLE.has(status),
      hasAudio: readySegments.length > 0,
      request,
      retry,
    }),
    [segments, readySegments, status, error, errorCode, generation, isRequesting, request, retry]
  );
};
