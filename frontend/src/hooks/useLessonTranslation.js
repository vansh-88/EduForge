import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGenerationStream } from './useGenerationStream';
import { requestTranslation, getTranslation } from '../api/lesson.api';
import { streamLessonTranslation } from '../api/stream';

/**
 * Translations already fetched this session, keyed `lessonId:language`.
 *
 * Module-level on purpose. `useApiResource` has no cross-component cache, so
 * without this every toggle back to Hinglish — and every return to a lesson —
 * would re-request a document that cannot have changed. A translation is keyed
 * to a source content hash server-side, so a cached one is either still correct
 * or is reported STALE the next time it is actually read.
 */
const cache = new Map();

const cacheKey = (lessonId, language) => `${lessonId}:${language}`;

/** Clears one lesson's cached translations. Exported for the lesson-regenerated case. */
export const invalidateTranslation = (lessonId, language = 'hinglish') => {
  cache.delete(cacheKey(lessonId, language));
};

// Statuses that mean a job is running and the stream is worth holding open.
const WATCHABLE = new Set(['PENDING', 'GENERATING', 'PROCESSING', 'RETRYING']);

/**
 * A Hinglish rendering of the current lesson, generated on demand.
 *
 * The English lesson stays the source of truth: this hook never touches it, and
 * the page decides which of the two to render. That is also why nothing here
 * refetches the lesson — a reader who is mid-page must not have it swapped out
 * from under them just because a translation arrived.
 *
 *   click → cached? render it
 *         → POST → 200 with content? render it
 *                → 202 → watch SSE → completed → GET translation → render it
 */
export const useLessonTranslation = ({ courseId, moduleId, lessonId, language = 'hinglish' }) => {
  const [content, setContent] = useState(null);
  const [status, setStatus] = useState('NOT_REQUESTED');
  const [error, setError] = useState(null);
  // Carried alongside the message so the page can tell a retryable failure from
  // one where retrying now is guaranteed to fail again (rate limit, spent quota).
  const [errorCode, setErrorCode] = useState(null);
  const [isRequesting, setIsRequesting] = useState(false);

  const key = cacheKey(lessonId, language);

  // Seed from the cache in the same render that changed the key, before any
  // stale value is painted — so navigating back to a lesson whose translation is
  // already known never flashes a spinner, and navigating to a new one never
  // shows the previous lesson's Hinglish. Same shape as useGenerationStream's
  // key reset.
  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    const cached = cache.get(key);
    setContent(cached ?? null);
    setStatus(cached ? 'READY' : 'NOT_REQUESTED');
    setError(null);
    setErrorCode(null);
  }

  // A lesson change must not leave a stale request writing into the new lesson's
  // state. Every async continuation below checks this first.
  const activeKeyRef = useRef(key);
  useEffect(() => {
    activeKeyRef.current = key;
  }, [key]);

  const store = useCallback(
    (translated) => {
      cache.set(key, translated);
      setContent(translated);
      setStatus('READY');
    },
    [key]
  );

  const load = useCallback(async () => {
    const requestedKey = activeKeyRef.current;
    try {
      const result = await getTranslation(courseId, moduleId, lessonId, language);
      if (activeKeyRef.current !== requestedKey) return;

      if (result.status === 'READY' && result.content) {
        store(result.content);
        return;
      }

      // READY was announced but the read disagrees — the lesson was regenerated
      // between the two. Report it rather than rendering content for a version
      // of the lesson that no longer exists.
      setStatus(result.status);
      setError(
        result.status === 'STALE'
          ? 'This lesson changed while it was being translated. Try again.'
          : 'The translation is not available yet.'
      );
    } catch (err) {
      if (activeKeyRef.current !== requestedKey) return;
      setStatus('FAILED');
      setError(err.message);
      setErrorCode(err.code ?? null);
    }
  }, [courseId, moduleId, lessonId, language, store]);

  /**
   * The in-flight guard.
   *
   * A ref rather than the `isRequesting` state because `request` is called from a
   * click handler and would otherwise close over a stale value — two fast clicks
   * would both see `isRequesting === false` and both POST, each with its own
   * idempotency key, which is exactly the duplicate the server-side dedupe is
   * there to catch rather than something to rely on.
   */
  const inFlightRef = useRef(false);

  const start = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const requestedKey = activeKeyRef.current;

    setIsRequesting(true);
    setError(null);
    setErrorCode(null);

    try {
      const result = await requestTranslation(courseId, moduleId, lessonId, language);
      if (activeKeyRef.current !== requestedKey) return;

      // Already cached server-side — the 200 body carries the content, so there
      // is nothing to wait for and no stream to open.
      if (result.status === 'READY' && result.content) {
        store(result.content);
        return;
      }

      // 202: a job is running. `enabled` below flips on and the stream takes over.
      setStatus(result.status ?? 'GENERATING');
    } catch (err) {
      if (activeKeyRef.current !== requestedKey) return;
      setStatus('FAILED');
      setError(err.message);
      setErrorCode(err.code ?? null);
    } finally {
      inFlightRef.current = false;
      if (activeKeyRef.current === requestedKey) setIsRequesting(false);
    }
  }, [courseId, moduleId, lessonId, language, store]);

  /**
   * Asks for the translation, unless there is already one or one is on its way.
   * Safe to call repeatedly — this is what the toolbar button calls.
   */
  const request = useCallback(() => {
    if (cache.has(key)) return;
    if (WATCHABLE.has(status)) return;
    return start();
  }, [key, status, start]);

  /**
   * A FAILED row is claimable again server-side, so a retry is simply another
   * request — and it deliberately skips the guards in `request`, which would
   * otherwise refuse on the FAILED status it is trying to clear.
   */
  const retry = useCallback(() => {
    cache.delete(key);
    setContent(null);
    setStatus('NOT_REQUESTED');
    setError(null);
    setErrorCode(null);
    return start();
  }, [key, start]);

  const subscribe = useCallback(
    (handlers) => streamLessonTranslation(courseId, moduleId, lessonId, language, handlers),
    [courseId, moduleId, lessonId, language]
  );

  const onTerminal = useCallback(
    (event) => {
      if (event.type === 'lesson_translation_failed') {
        setStatus('FAILED');
        setError(event.lastError || 'Translation failed. You can try again.');
        return;
      }

      if (event.type === 'course_deleted') return;

      // 'lesson_translation_completed', or 'stream_closed' — the latter meaning
      // the server judged from the database that nothing more is coming, which
      // happens when the job finished between the POST and the subscribe. Either
      // way the row moved without us, so read it.
      //
      // The event says only *that* it completed; the read is what learns what it
      // produced. Same discipline the video slots follow.
      load();
    },
    [load]
  );

  const onEvent = useCallback((event) => {
    // The opening snapshot can report a terminal state that no live event will
    // ever repeat — a FAILED row from an earlier attempt, say.
    if (event.type === 'lesson_translation_generation_snapshot' && event.status === 'failed') {
      setError(event.lastError || 'Translation failed. You can try again.');
    }
  }, []);

  const onFatal = useCallback((err) => {
    setStatus('FAILED');
    setError(err.message);
  }, []);

  const generation = useGenerationStream({
    // Only while a job is actually running. Content already in hand means there
    // is nothing left to watch.
    enabled: !content && WATCHABLE.has(status),
    streamKey: key,
    subscribe,
    onEvent,
    onTerminal,
    onFatal,
  });

  return useMemo(
    () => ({
      content,
      status,
      error,
      errorCode,
      generation,
      isPending: isRequesting || (!content && WATCHABLE.has(status)),
      hasTranslation: Boolean(content),
      request,
      retry,
    }),
    [content, status, error, errorCode, generation, isRequesting, request, retry]
  );
};
