import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCourse } from '../../hooks/useCourse';
import { retryCourseGeneration, deleteCourse } from '../../api/course.api';
import { Button, Spinner, ProgressBar, ErrorState } from '../../components/common';
import { DifficultyBadge } from '../../components/course/DifficultyBadge';
import { ModuleAccordion } from '../../components/course/ModuleAccordion';
import { GenerationProgress } from '../../components/generation/GenerationProgress';
import { COURSE_STAGE_LABELS } from '../../components/generation/stageLabels';
import { lessonPath } from '../../utils/paths';

/**
 * Finds the lesson the reader should land on, and the module holding it.
 *
 * Prefers where they left off; otherwise the first lesson of the course. Both
 * the primary button and the accordion's default-open module come from here, so
 * they can never disagree.
 */
const findResumeTarget = (modules, lastVisitedLessonId) => {
  if (!modules?.length) return null;

  if (lastVisitedLessonId) {
    for (const module of modules) {
      const lesson = (module.lessons ?? []).find(
        (candidate) => candidate.id === lastVisitedLessonId
      );
      if (lesson) return { moduleId: module.id, lessonId: lesson.id };
    }
    // Falls through when the saved lesson no longer exists.
  }

  const firstModule = modules.find((module) => module.lessons?.length);
  if (!firstModule) return null;

  return { moduleId: firstModule.id, lessonId: firstModule.lessons[0].id };
};

export default function CourseOverview() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const {
    course,
    progress,
    completedLessonIds,
    generation,
    isGenerating,
    isLoading,
    error,
    refetch,
  } = useCourse(courseId);

  const [isRetrying, setIsRetrying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);

  const resumeTarget = useMemo(
    () => findResumeTarget(course?.modules, progress?.lastVisitedLessonId),
    [course?.modules, progress?.lastVisitedLessonId]
  );

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setActionError(null);
    try {
      await retryCourseGeneration(courseId);
      // Puts the course back into an in-flight state, which reopens the stream.
      refetch();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setIsRetrying(false);
    }
  }, [courseId, refetch]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Delete this course and all its lessons? This cannot be undone.')) {
      return;
    }

    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteCourse(courseId);
      navigate('/courses');
    } catch (err) {
      setActionError(err.message);
      setIsDeleting(false);
    }
  }, [courseId, navigate]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto mt-8 max-w-3xl">
        <ErrorState
          title={
            error.status === 404
              ? 'This course no longer exists'
              : "We couldn't load this course"
          }
          message={error.message}
          onRetry={error.status === 404 ? undefined : refetch}
        />
      </div>
    );
  }

  const hasFailed = course.status === 'FAILED';

  return (
    <div className="mx-auto mt-8 max-w-3xl pb-16">
      <header>
        {/* Title is null until generation produces one — the original prompt stands in. */}
        <h1 className="text-2xl font-bold text-gray-900">
          {course.title || course.query}
        </h1>

        {course.description && (
          <p className="mt-2 text-gray-600">{course.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DifficultyBadge difficulty={course.difficulty} />

          {course.status === 'READY' && (
            <span className="text-xs text-gray-500">
              {course.moduleCount} modules · {course.lessonCount} lessons
            </span>
          )}

          {course.tags?.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      {actionError && (
        <div className="mt-6">
          <ErrorState title="That didn't work" message={actionError} />
        </div>
      )}

      {isGenerating && (
        <div className="mt-6">
          <GenerationProgress
            generation={generation}
            stageLabels={COURSE_STAGE_LABELS}
            title="Building your course"
          />
        </div>
      )}

      {hasFailed && (
        <div className="mt-6">
          <ErrorState
            title="We couldn't build this course"
            message={
              course.lastError ||
              'Generation failed. Retrying will start it again from scratch.'
            }
          />
          <Button className="mt-4" onClick={handleRetry} loading={isRetrying}>
            Retry generation
          </Button>
        </div>
      )}

      {course.status === 'READY' && (
        <>
          {course.learningGoals?.length > 0 && (
            <section className="mt-8 rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900">
                What you'll learn
              </h2>
              <ul className="mt-3 space-y-1.5">
                {course.learningGoals.map((goal) => (
                  <li key={goal} className="flex gap-2 text-sm text-gray-600">
                    <span className="text-blue-600">•</span>
                    {goal}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8">
            <div className="flex items-end justify-between gap-4">
              <ProgressBar
                className="flex-1"
                value={progress?.percentage ?? 0}
                label={`${progress?.completedLessons ?? 0}/${
                  progress?.totalLessons ?? 0
                } lessons complete`}
              />

              {resumeTarget && (
                <Button
                  onClick={() =>
                    navigate(
                      lessonPath(courseId, resumeTarget.moduleId, resumeTarget.lessonId)
                    )
                  }
                >
                  {progress?.status === 'not_started'
                    ? 'Start learning'
                    : 'Continue learning'}
                </Button>
              )}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Curriculum</h2>
            <ModuleAccordion
              modules={course.modules}
              courseId={courseId}
              completedLessonIds={completedLessonIds}
              openModuleId={resumeTarget?.moduleId}
            />
          </section>
        </>
      )}

      <div className="mt-12 border-t border-gray-200 pt-6">
        <Button variant="secondary" onClick={handleDelete} loading={isDeleting}>
          Delete course
        </Button>
      </div>
    </div>
  );
}
