import { useCallback } from 'react';
import { useApiResource } from './useApiResource';
import { useGenerationStream } from './useGenerationStream';
import { getCourse } from '../api/course.api';
import { streamCourseGeneration } from '../api/stream';

// Mongo lifecycle values that mean work is still in flight. The wire statuses on
// the SSE side are lowercase and coarser; these are the raw document ones.
const IN_FLIGHT = new Set(['GENERATING', 'PROCESSING', 'RETRYING']);

export const isCourseGenerating = (course) => IN_FLIGHT.has(course?.status);

/**
 * A course plus its live generation progress.
 *
 * getCourseById returns a raw lean document — `_id`, not `id` — while the
 * dashboard returns `id`. Normalizing here means components see one shape and
 * the `id ?? _id` fallbacks can eventually go away.
 */
const normalize = (payload) => {
  if (!payload?.course) return null;

  const { course, progress } = payload;

  return {
    course: {
      ...course,
      id: String(course._id),
      modules: (course.modules ?? []).map((module) => ({
        ...module,
        id: String(module._id),
        lessons: (module.lessons ?? []).map((lesson) => ({
          ...lesson,
          id: String(lesson._id),
        })),
      })),
    },
    progress,
  };
};

export const useCourse = (courseId) => {
  const { data, isLoading, error, refetch } = useApiResource(
    async () => normalize(await getCourse(courseId)),
    [courseId]
  );

  const course = data?.course ?? null;

  const subscribe = useCallback(
    (handlers) => streamCourseGeneration(courseId, handlers),
    [courseId]
  );

  // Generation finished, failed, or the course was deleted — either way the
  // document changed underneath us, so MongoDB gets the last word rather than
  // the event payload.
  const onTerminal = useCallback(() => refetch(), [refetch]);

  const generation = useGenerationStream({
    // Only stream while there is something to watch. A READY course opens no
    // connection at all.
    enabled: isCourseGenerating(course),
    streamKey: courseId,
    subscribe,
    onTerminal,
  });

  return {
    course,
    progress: data?.progress ?? null,
    generation,
    isGenerating: isCourseGenerating(course),
    isLoading,
    error,
    refetch,
  };
};
