import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChatSession, getChatSession } from '../api/chat.api';
import { streamTutorMessage } from '../api/stream';

/**
 * The Course Tutor conversation for one lesson.
 *
 * Conversations already loaded this session, keyed `courseId:lessonId`.
 *
 * Module-level for the same reason useLessonTranslation keeps one: there is no
 * cross-component query cache in this app, so without it every return to a lesson
 * would refetch a conversation that cannot have changed, and every toggle of the
 * panel would lose what the student had already asked.
 */
const cache = new Map();

const cacheKey = (courseId, lessonId) => `${courseId}:${lessonId ?? 'course'}`;

/** Clears one lesson's cached conversation. Exported for the delete path. */
export const invalidateTutorConversation = (courseId, lessonId) => {
  cache.delete(cacheKey(courseId, lessonId));
};

/**
 * A conversation with the tutor, grounded in the current lesson.
 *
 *   ask() -> ensure a session exists (created lazily, on the first question)
 *         -> POST the question, stream the answer in
 *         -> tokens append to the last assistant message as they arrive
 *
 * The lesson itself is never touched. A reader mid-page must not have content
 * swapped under them because they asked a question about it.
 */
export const useCourseTutor = ({ courseId, lessonId }) => {
  const key = cacheKey(courseId, lessonId);

  const [messages, setMessages] = useState(() => cache.get(key)?.messages ?? []);
  const [sessionId, setSessionId] = useState(() => cache.get(key)?.sessionId ?? null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  // True when the answer was produced without the course index — a still-building
  // index, or a question that could not be embedded. Worth saying, because it is the
  // difference between "your course does not cover this" and "we could not look".
  const [degraded, setDegraded] = useState(false);

  /*
   * Reset in the SAME render that changed the lesson, before anything stale is
   * painted. The same discipline Learn.jsx already uses for language and the audio
   * player, and useLessonTranslation for its cache key: an effect would run after a
   * paint that briefly shows the previous lesson's conversation under the new one.
   */
  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    const cached = cache.get(key);
    setMessages(cached?.messages ?? []);
    setSessionId(cached?.sessionId ?? null);
    setIsStreaming(false);
    setError(null);
    setErrorCode(null);
    setDegraded(false);
  }

  // Every async continuation checks this before writing state, so an answer that
  // arrives after the reader has moved on cannot land in the new lesson's panel.
  const activeKeyRef = useRef(key);
  useEffect(() => {
    activeKeyRef.current = key;
  }, [key]);

  // Aborts the in-flight stream. Held in a ref because unmount and a second send
  // both need it, and neither can see a state value captured at render time.
  const abortRef = useRef(null);

  // Written on every state change so a remount restores the conversation without a
  // round trip. Messages live here rather than in the cache directly so the cache is
  // only ever updated with what was actually rendered.
  useEffect(() => {
    if (messages.length > 0 || sessionId) cache.set(key, { messages, sessionId });
  }, [key, messages, sessionId]);

  // A stream left running after the panel closes would keep appending to state
  // nobody is showing, and keeps the answer generating server-side.
  useEffect(() => () => abortRef.current?.(), []);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const session = await createChatSession(courseId, lessonId ?? null);
    setSessionId(session.id);
    return session.id;
  }, [sessionId, courseId, lessonId]);

  /**
   * The in-flight guard.
   *
   * A ref rather than `isStreaming`, because ask() is called from a submit handler
   * that closes over the value at render time — two fast submits would both read
   * false and both send.
   */
  const inFlightRef = useRef(false);

  const ask = useCallback(
    async (question) => {
      const text = question?.trim();
      if (!text || inFlightRef.current) return;

      inFlightRef.current = true;
      const requestedKey = activeKeyRef.current;

      setError(null);
      setErrorCode(null);
      setDegraded(false);
      setIsStreaming(true);

      // Shown immediately, before the request is even made. The student's own words
      // appearing instantly is what makes the wait for an answer feel like thinking
      // rather than like nothing happening.
      const pendingId = `pending-${Date.now()}`;
      setMessages((prior) => [
        ...prior,
        { id: pendingId, role: 'user', content: text },
        { id: `${pendingId}-answer`, role: 'assistant', content: '', streaming: true, sources: [] },
      ]);

      // Makes a retry free rather than a second question: the server replays the
      // stored answer instead of asking the model again.
      const clientMessageId = crypto.randomUUID();

      let session;
      try {
        session = await ensureSession();
      } catch (err) {
        if (activeKeyRef.current === requestedKey) {
          setMessages((prior) => prior.filter((m) => !m.id.startsWith(pendingId)));
          setError(err.message);
          setErrorCode(err.code ?? null);
          setIsStreaming(false);
        }
        inFlightRef.current = false;
        return;
      }

      // Mutates the trailing assistant message in place as tokens arrive.
      const appendToAnswer = (patch) =>
        setMessages((prior) => {
          const next = [...prior];
          const last = next.at(-1);
          if (!last || last.role !== 'assistant') return prior;
          next[next.length - 1] = typeof patch === 'function' ? patch(last) : { ...last, ...patch };
          return next;
        });

      const finish = () => {
        inFlightRef.current = false;
        abortRef.current = null;
        if (activeKeyRef.current === requestedKey) setIsStreaming(false);
      };

      abortRef.current = streamTutorMessage(
        courseId,
        session,
        { message: text, clientMessageId },
        {
          onEvent: (event) => {
            if (activeKeyRef.current !== requestedKey) return;

            if (event.type === 'message_start') {
              if (event.retrievalDegraded) setDegraded(true);
              return;
            }

            // Citations arrive BEFORE the first token, so the source rail can render
            // while the answer is still being written.
            if (event.type === 'sources') {
              appendToAnswer({ sources: event.sources ?? [] });
              return;
            }

            if (event.type === 'token') {
              appendToAnswer((last) => ({ ...last, content: last.content + event.text }));
            }
          },

          onTerminal: (event) => {
            if (activeKeyRef.current !== requestedKey) return finish();

            if (event.type === 'message_failed') {
              setError(event.error || 'The tutor could not answer. Please try again.');
              setErrorCode(event.code ?? null);
              // A partial answer is kept rather than discarded — the server persisted
              // it too, so throwing it away here would make the panel disagree with
              // the conversation on reload.
              appendToAnswer((last) => ({
                ...last,
                streaming: false,
                truncated: Boolean(last.content),
              }));
              return finish();
            }

            appendToAnswer((last) => ({
              ...last,
              streaming: false,
              id: event.messageId ?? last.id,
              truncated: Boolean(event.truncated),
            }));
            finish();
          },

          onFatal: (err) => {
            if (activeKeyRef.current === requestedKey) {
              setError(err.message);
              appendToAnswer((last) => ({ ...last, streaming: false }));
            }
            finish();
          },
        }
      );
    },
    [courseId, ensureSession]
  );

  /** Abandons the answer being written. The server persists what it produced. */
  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    inFlightRef.current = false;
    setIsStreaming(false);
    setMessages((prior) => {
      const next = [...prior];
      const last = next.at(-1);
      if (last?.role === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, streaming: false, truncated: true };
      }
      return next;
    });
  }, []);

  /**
   * Re-reads the conversation from the server.
   *
   * Only needed after a truncated answer: the server persisted the full text it
   * generated before the disconnect, which may be more than reached this client.
   */
  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const requestedKey = activeKeyRef.current;
    try {
      const detail = await getChatSession(courseId, sessionId);
      if (activeKeyRef.current !== requestedKey) return;
      setMessages(detail.messages);
    } catch {
      // Best-effort: what is on screen is still what the student saw.
    }
  }, [courseId, sessionId]);

  return useMemo(
    () => ({
      messages,
      sessionId,
      isStreaming,
      error,
      errorCode,
      degraded,
      hasConversation: messages.length > 0,
      ask,
      stop,
      refresh,
    }),
    [messages, sessionId, isStreaming, error, errorCode, degraded, ask, stop, refresh]
  );
};
