import { useCallback, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useLesson } from '../../hooks/useLesson';
import { Button, Spinner, ErrorState } from '../../components/common';
import { BlockRenderer } from '../../components/lesson/BlockRenderer';
import { LessonToolbar } from '../../components/lesson/LessonToolbar';
import { GenerationProgress } from '../../components/generation/GenerationProgress';
import { LESSON_STAGE_LABELS } from '../../components/generation/stageLabels';
import { coursePath, lessonPath } from '../../utils/paths';

const QuizSummary = ({ quiz }) => {
  if (!quiz?.total) return null;

  return (
    <div className="flex items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      <span className="text-body">
        Quiz: <strong className="text-ink">{quiz.answered}</strong> of {quiz.total}{' '}
        answered
      </span>

      {quiz.answered > 0 && (
        <span className="text-body">
          <strong className="text-ink">{quiz.correct}</strong> correct
        </span>
      )}

      {quiz.completed && (
        <span className="ml-auto text-xs font-medium text-success-text">
          Quiz complete
        </span>
      )}
    </div>
  );
};

export default function Learn() {
  const { courseId, moduleId, lessonId } = useParams();
  const navigate = useNavigate();

  const onDeleted = useCallback(() => navigate('/courses'), [navigate]);

  const {
    lesson,
    quiz,
    quizByQuestionId,
    navigation,
    generation,
    isGenerating,
    isLoading,
    error,
    requestError,
    isRequesting,
    retryGeneration,
    answerQuestion,
    markComplete,
    refetch,
  } = useLesson({ courseId, moduleId, lessonId, onDeleted });

  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(null);

  const goTo = useCallback(
    (target) => navigate(lessonPath(courseId, target.moduleId, target.lessonId)),
    [navigate, courseId]
  );

  const handleComplete = useCallback(async () => {
    setIsCompleting(true);
    setCompleteError(null);
    try {
      await markComplete();
      // Completing is also how the reader moves on; the backend has already
      // queued the lookahead for whatever comes next.
      if (navigation?.next) goTo(navigation.next);
    } catch (err) {
      setCompleteError(err.message);
    } finally {
      setIsCompleting(false);
    }
  }, [markComplete, navigation, goTo]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-primary-text" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto mt-8 max-w-3xl">
        <ErrorState
          title={
            error.status === 404
              ? 'This lesson no longer exists'
              : "We couldn't load this lesson"
          }
          message={error.message}
          onRetry={error.status === 404 ? undefined : refetch}
        />
      </div>
    );
  }

  const isReady = lesson.status === 'READY';
  const hasFailed = lesson.status === 'FAILED';

  return (
    <article className="mx-auto mt-8 max-w-3xl pb-20">
      <Link
        to={coursePath(courseId)}
        className="text-sm text-muted transition hover:text-primary-text"
      >
        ← Back to course
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-ink">{lesson.title}</h1>
          <LessonToolbar />
        </div>

        {lesson.completed && (
          <p className="mt-2 text-sm font-medium text-success-text">✓ Completed</p>
        )}

        {lesson.objectives?.length > 0 && (
          <section className="mt-5 rounded-lg border border-line bg-subtle p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              In this lesson
            </h2>
            <ul className="mt-2 space-y-1">
              {lesson.objectives.map((objective) => (
                <li key={objective} className="flex gap-2 text-sm text-body">
                  <span className="text-primary-text">•</span>
                  {objective}
                </li>
              ))}
            </ul>
          </section>
        )}
      </header>

      {requestError && (
        <div className="mt-6">
          <ErrorState title="We couldn't start generation" message={requestError} />
        </div>
      )}

      {isGenerating && (
        <div className="mt-6">
          <GenerationProgress
            generation={generation}
            stageLabels={LESSON_STAGE_LABELS}
            title="Writing this lesson"
            idleLabel="Getting started"
          />
        </div>
      )}

      {hasFailed && !isGenerating && (
        <div className="mt-6">
          <ErrorState
            title="We couldn't write this lesson"
            message={
              lesson.generation?.lastError ||
              'Generation failed. You can try again — the rest of the course is unaffected.'
            }
          />
          <Button className="mt-4" onClick={retryGeneration} loading={isRequesting}>
            Try again
          </Button>
        </div>
      )}

      {isReady && (
        <>
          <div className="mt-8">
            <BlockRenderer
              blocks={lesson.content}
              quizByQuestionId={quizByQuestionId}
              onAnswer={answerQuestion}
            />
          </div>

          <div className="mt-10">
            <QuizSummary quiz={quiz} />
          </div>
        </>
      )}

      {completeError && (
        <p className="mt-4 text-sm text-danger-text">{completeError}</p>
      )}

      <nav className="mt-10 flex items-center justify-between gap-4 border-t border-line pt-6">
        {navigation?.previous ? (
          <Button variant="secondary" onClick={() => goTo(navigation.previous)}>
            ← Previous
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {/* Completing a lesson the reader cannot have read would inflate their
              progress, which the backend rejects with LESSON_NOT_READY anyway. */}
          <Button
            onClick={handleComplete}
            disabled={!isReady}
            loading={isCompleting}
          >
            {navigation?.next
              ? lesson.completed
                ? 'Next lesson →'
                : 'Mark complete & continue'
              : 'Mark complete'}
          </Button>

          {navigation?.next && lesson.completed && (
            <Button variant="secondary" onClick={() => goTo(navigation.next)}>
              Skip →
            </Button>
          )}
        </div>
      </nav>
    </article>
  );
}
