import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiResource } from './useApiResource';
import { useGenerationStream } from './useGenerationStream';
import {
  getLesson,
  getVideoSlots,
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

      // Every slot has settled, and each one was already patched in as it
      // landed. Refetching here would undo the whole point of doing that.
      if (event.type === 'lesson_enrichment_completed') return;

      // 'lesson_generation_failed', or 'stream_closed' — the latter meaning the
      // server judged from MongoDB that nothing more is coming and hung up,
      // which happens when the work finished between our fetch and the
      // subscription. Either way the document moved without us, so re-read it.
      refetch();
    },
    [refetch, onDeleted]
  );

  // Video slots settle after the content is already readable, so this fires at
  // a reader who is mid-lesson. It must therefore change as little as possible:
  // a full refetch would swap `data` wholesale and, because the page branches on
  // isLoading, blank the lesson to a spinner and lose their scroll position.
  //
  // So only the affected blocks are replaced, in place. Every other block keeps
  // its existing object reference, so React re-renders nothing else — a code
  // block's copy state and a half-answered question both survive.
  //
  // The event says only *that* a slot changed; the slot read is what learns what
  // it changed to, keeping MongoDB authoritative rather than trusting the event.
  const onEvent = useCallback(
    async (event) => {
      // Content just arrived for a lesson that was empty. A full re-read is
      // right here — there is nothing on screen worth preserving, and this is
      // no longer a terminal event (video slots keep publishing after it), so
      // onTerminal will not fire for it.
      if (event.type === 'lesson_generation_completed') {
        refetch();
        return;
      }

      if (!event.type?.startsWith('video_slot_')) return;

      let slots;
      let enrichment;
      try {
        ({ slots, enrichment } = await getVideoSlots(courseId, moduleId, lessonId));
      } catch {
        // A missed update is not worth disturbing the page over; the next event,
        // or the next navigation, resolves it.
        return;
      }

      const bySlotId = new Map(slots.map((slot) => [slot.slotId, slot]));

      setData((previous) => {
        if (!previous?.lesson) return previous;

        return {
          ...previous,
          lesson: {
            ...previous.lesson,
            content: previous.lesson.content.map((block) => {
              if (block.type !== 'video') return block;

              const slot = bySlotId.get(block.slotId);
              if (!slot) return block;

              // Rebuilt rather than spread over the old block, so a field the
              // new slot omits — `video`, once a slot is no longer READY —
              // cannot linger from the previous state. Mirrors exactly what
              // toVideoBlockDTO produces on the server; caption is the only
              // part that comes from the content block rather than the slot.
              return { type: 'video', caption: block.caption ?? null, ...slot };
            }),
            // Must be patched too, not just the blocks: `enabled` below is
            // derived from it, so a stale count either closes the stream while
            // slots are still resolving or holds it open forever.
            enrichment,
          },
        };
      });
    },
    [courseId, moduleId, lessonId, setData, refetch]
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
