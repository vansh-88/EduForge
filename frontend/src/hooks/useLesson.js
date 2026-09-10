import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiResource } from './useApiResource';
import { useGenerationStream } from './useGenerationStream';
import {
  getLesson,
  generateLesson,
  submitAnswer,
  completeLesson,
} from '../api/lesson.api';
import { streamLessonGeneration } from '../api/stream';

// Statuses for which a generation stream is worth opening. PENDING is included
// because the auto-trigger below fires the moment we see it — by the time the
// stream connects the server is already generating, and the opening snapshot
// tells us where it got to.
const WATCHABLE = new Set(['PENDING', 'GENERATING', 'PROCESSING', 'RETRYING']);

/**
 * A lesson, generated on demand if it doesn't exist yet.
 *
 * The whole reason this hook is more than a fetch: `GET` deliberately never
 * generates the lesson being requested (it only pulls the lookahead forward),
 * so an un-generated lesson comes back READY-shaped but empty. Turning that
 * into content is the client's job:
 *
 *   GET → PENDING? → POST generate → watch SSE → terminal → GET again
 *
 * Failures are deliberately *not* auto-retried. A FAILED lesson has already
 * burned its server-side attempts, so re-requesting on every page load would
 * spend three more AI calls each time a reader lands on a broken lesson. The
 * page offers a button instead.
 */
export const useLesson = ({ courseId, moduleId, lessonId, onDeleted }) => {
  const { data, isLoading, error, refetch, setData } = useApiResource(
    () => getLesson(courseId, moduleId, lessonId),
    [courseId, moduleId, lessonId]
  );

  const lesson = data?.lesson ?? null;
  const status = lesson?.status;

  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState(null);

  const startGeneration = useCallback(async () => {
    setIsRequesting(true);
    setRequestError(null);
    try {
      await generateLesson(courseId, moduleId, lessonId);
      // Pull the fresh status in so the stream's `enabled` flips on even if the
      // lesson was FAILED (and therefore not being watched) a moment ago.
      refetch();
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setIsRequesting(false);
    }
  }, [courseId, moduleId, lessonId, refetch]);

  // Auto-start generation for a lesson that has never been generated.
  //
  // The ref holds the lesson we have already fired for. StrictMode mounts twice
  // in development, and every POST carries a fresh Idempotency-Key, so without
  // this guard the second mount would be a genuinely new request — two Gemini
  // calls for one lesson view.
  const autoStartedRef = useRef(null);

  useEffect(() => {
    if (status !== 'PENDING') return;
    if (autoStartedRef.current === lessonId) return;

    autoStartedRef.current = lessonId;

    // Fire and forget: state is only touched from the async callbacks, never
    // synchronously inside the effect.
    generateLesson(courseId, moduleId, lessonId).catch((err) => {
      setRequestError(err.message);
    });
  }, [status, courseId, moduleId, lessonId]);

  const subscribe = useCallback(
    (handlers) => streamLessonGeneration(courseId, moduleId, lessonId, handlers),
    [courseId, moduleId, lessonId]
  );

  const onTerminal = useCallback(
    (event) => {
      if (event.type === 'course_deleted') {
        onDeleted?.();
        return;
      }
      // Ready or failed — either way MongoDB, not the event, is the authority
      // on what the lesson now contains.
      refetch();
    },
    [refetch, onDeleted]
  );

  // Video slots settle after the content is already readable, and each one is a
  // change to the lesson. The event only says *that* something changed; the
  // refetch is what learns what it changed to, keeping MongoDB authoritative.
  const onEvent = useCallback(
    (event) => {
      if (event.type?.startsWith('video_slot_')) refetch();
    },
    [refetch]
  );

  // Enrichment outlives generation: a READY lesson whose video slots are still
  // resolving must keep its stream open, or the updates it is waiting for are
  // published to nobody.
  const pendingEnrichment = data?.lesson?.enrichment?.pending ?? 0;

  const generation = useGenerationStream({
    enabled: WATCHABLE.has(status) || (status === 'READY' && pendingEnrichment > 0),
    streamKey: lessonId,
    subscribe,
    onEvent,
    onTerminal,
  });

  /** Question id → its graded state, so blocks don't scan the array each render. */
  const quizByQuestionId = useMemo(() => {
    const questions = data?.quiz?.questions ?? [];
    return Object.fromEntries(questions.map((question) => [question.questionId, question]));
  }, [data?.quiz?.questions]);

  const answerQuestion = useCallback(
    async (questionId, selected) => {
      const result = await submitAnswer(
        courseId,
        moduleId,
        lessonId,
        questionId,
        selected
      );

      // The response already carries the graded record and the new totals, so
      // patch in place — refetching the whole lesson to learn what we were just
      // told would throw away the content for no reason.
      setData((previous) => {
        if (!previous) return previous;

        return {
          ...previous,
          quiz: {
            ...previous.quiz,
            ...result.progress,
            questions: previous.quiz.questions.map((question) =>
              question.questionId === questionId
                ? {
                    questionId,
                    answered: true,
                    selected: result.selected,
                    correct: result.correct,
                    correctAnswer: result.correctAnswer,
                    explanation: result.explanation,
                    answeredAt: new Date().toISOString(),
                  }
                : question
            ),
          },
        };
      });

      return result;
    },
    [courseId, moduleId, lessonId, setData]
  );

  const markComplete = useCallback(async () => {
    const result = await completeLesson(courseId, moduleId, lessonId);

    setData((previous) =>
      previous ? { ...previous, lesson: { ...previous.lesson, completed: true } } : previous
    );

    return result;
  }, [courseId, moduleId, lessonId, setData]);

  return {
    lesson,
    quiz: data?.quiz ?? null,
    quizByQuestionId,
    navigation: data?.navigation ?? null,
    generation,
    isGenerating: WATCHABLE.has(status),
    isLoading,
    error,
    requestError,
    isRequesting,
    retryGeneration: startGeneration,
    answerQuestion,
    markComplete,
    refetch,
  };
};
