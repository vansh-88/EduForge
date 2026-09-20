import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { useLesson } from '../../hooks/useLesson';
import { useLessonTranslation } from '../../hooks/useLessonTranslation';
import { useLessonAudio } from '../../hooks/useLessonAudio';
import { usePdfExport } from '../../hooks/usePdfExport';
import { Button, Spinner, ErrorState } from '../../components/common';
import { BlockRenderer } from '../../components/lesson/BlockRenderer';
import { LessonToolbar } from '../../components/lesson/LessonToolbar';
import { TutorPanel } from '../../components/course-tutor';
import { AudioPlayer } from '../../components/lesson/AudioPlayer';
import { GenerationProgress } from '../../components/generation/GenerationProgress';
import { LESSON_STAGE_LABELS, TRANSLATION_STAGE_LABELS, AUDIO_STAGE_LABELS } from '../../components/generation/stageLabels';
import { coursePath, lessonPath } from '../../utils/paths';

// Failures where trying again right now is guaranteed to fail again. Offering a
// retry button for these is worse than offering nothing: it invites the reader to
// spend a click confirming the same refusal.
const NOT_WORTH_RETRYING = new Set(['RATE_LIMITED', 'AI_QUOTA_EXHAUSTED']);

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
  const { hash } = useLocation();

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

  /*
   * Scrolls to the passage a tutor citation pointed at.
   *
   * Runs on content as well as hash, because the two race: following a citation to
   * ANOTHER lesson navigates before that lesson has loaded, so the anchor does not
   * exist yet on the first pass. Re-running once the blocks are rendered is what
   * makes a cross-lesson citation land in the right place rather than at the top.
   *
   * Silent when the anchor is missing — a stale citation should leave the reader at
   * the top of a lesson, which is exactly where a normal navigation puts them.
   */
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, lesson?.content]);

  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(null);

  const translation = useLessonTranslation({ courseId, moduleId, lessonId });

  const [language, setLanguage] = useState('english');

  // Each lesson is translated separately, so arriving at a new one starts in
  // English regardless of what the last one was showing. Reset in the same
  // render that changed the lesson, before the old language is painted against
  // new content.
  const audio = useLessonAudio({ courseId, moduleId, lessonId });
  const [showPlayer, setShowPlayer] = useState(false);
  const [showTutor, setShowTutor] = useState(false);

  const [renderedLessonId, setRenderedLessonId] = useState(lessonId);
  if (renderedLessonId !== lessonId) {
    setRenderedLessonId(lessonId);
    setLanguage('english');
    // The player is dismissed on navigation rather than carried over: it would
    // otherwise keep reading the previous lesson under the new one's text.
    setShowPlayer(false);
    // The panel closes too, but the CONVERSATION is not lost — useCourseTutor keys
    // its cache by lesson, so returning here brings the same exchange back.
    setShowTutor(false);
  }

  // Opens the player and asks for audio the first time; toggles it thereafter.
  const handleListen = useCallback(() => {
    if (audio.hasAudio) {
      setShowPlayer((visible) => !visible);
      return;
    }

    setShowPlayer(true);
    audio.request();
  }, [audio]);

  const showingHinglish = language === 'hinglish' && Boolean(translation.content);

  /**
   * The blocks actually rendered.
   *
   * Video blocks come from the English lesson rather than the translation: only
   * their caption is translated, while the resolved video itself lives on the
   * English block, which the lesson's SSE stream has been patching in place.
   * Taking the translated block wholesale would throw that away and show a
   * spinner for a video that resolved minutes ago.
   */
  const displayContent = useMemo(() => {
    if (!showingHinglish) return lesson?.content ?? [];

    const englishVideos = new Map(
      (lesson?.content ?? [])
        .filter((block) => block.type === 'video')
        .map((block) => [block.slotId, block])
    );

    return translation.content.map((block) => {
      if (block.type !== 'video') return block;

      const english = englishVideos.get(block.slotId);
      if (!english) return block;

      return { ...english, caption: block.caption ?? english.caption ?? null };
    });
  }, [showingHinglish, lesson?.content, translation.content]);

  // Toggles once a translation exists; asks for one the first time.
  const handleHinglish = useCallback(() => {
    if (translation.content) {
      setLanguage((current) => (current === 'hinglish' ? 'english' : 'hinglish'));
      return;
    }

    // Switch optimistically: the render below still shows English until the
    // content lands, and this way the view flips the moment it does.
    setLanguage('hinglish');
    translation.request();
  }, [translation]);

  const {
    exportPdf,
    isExporting,
    error: exportError,
  } = usePdfExport({
    courseId,
    moduleId,
    // The export is a snapshot of what is on screen, so a reader who exports
    // while reading Hinglish gets the Hinglish PDF. Safe with jsPDF's built-in
    // fonts because the translation is romanised — see pdf/pdfText.js.
    lesson: lesson && showingHinglish ? { ...lesson, content: displayContent } : lesson,
    quizByQuestionId,
  });

  const goTo = useCallback(
    (target) => navigate(lessonPath(courseId, target.moduleId, target.lessonId)),
    [navigate, courseId]
  );

  const handleComplete = useCallback(async () => {
    // Revisiting a finished lesson: there is nothing to record, so this is a
    // plain move to the next one. markLessonComplete is idempotent server-side,
    // but calling it anyway would spend a round trip — and a spinner — to change
    // nothing.
    if (lesson?.completed) {
      if (navigation?.next) goTo(navigation.next);
      return;
    }

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
  }, [lesson?.completed, markComplete, navigation, goTo]);

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
    /*
     * One column normally, two when the tutor is open — and only from `lg` up.
     *
     * The grid wraps the article rather than the article containing the panel, so
     * the lesson keeps its own max-width and measure. Below `lg` the panel drops
     * beneath the lesson at full width: a narrow column beside phone-width text
     * would leave neither readable.
     */
    <div
      className={`mx-auto mt-8 pb-20 ${
        showTutor
          ? 'grid max-w-7xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]'
          : 'max-w-3xl'
      }`}
    >
    <article className={showTutor ? 'min-w-0' : ''}>
      <Link
        to={coursePath(courseId)}
        className="text-sm text-muted transition hover:text-primary-text"
      >
        ← Back to course
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-ink">{lesson.title}</h1>
          {/* Export is only meaningful once there is content; the toolbar
              disables any action without a handler. */}
          <LessonToolbar
            handlers={{
              pdf: lesson.status === 'READY' ? exportPdf : undefined,
              // Nothing to translate or read aloud until there is content.
              hinglish: lesson.status === 'READY' ? handleHinglish : undefined,
              tts: lesson.status === 'READY' ? handleListen : undefined,
              // Nothing to ground an answer in until the lesson has content.
              tutor: lesson.status === 'READY' ? () => setShowTutor((open) => !open) : undefined,
            }}
            busy={{
              pdf: isExporting,
              hinglish: translation.isPending,
              // Busy only until the first section is playable — after that the
              // player itself shows that more is still coming.
              tts: audio.isPreparing,
            }}
            active={{ hinglish: showingHinglish, tts: showPlayer && audio.hasAudio, tutor: showTutor }}
          />
        </div>

        {lesson.completed && (
          <p className="mt-2 text-sm font-medium text-success-text">✓ Completed</p>
        )}

        {/* Inline rather than replacing the page: a failed export must not take
            the lesson away from the reader. */}
        {exportError && <p className="mt-2 text-sm text-danger-text">{exportError}</p>}

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

      {/* Inline, above the content, because the lesson stays readable in English
          the whole time a translation is being produced. */}
      {isReady && translation.isPending && (
        <div className="mt-6">
          <GenerationProgress
            generation={translation.generation}
            stageLabels={TRANSLATION_STAGE_LABELS}
            title="Translating this lesson to Hinglish"
            idleLabel="Getting started"
          />
        </div>
      )}

      {/* Only while there is genuinely nothing to listen to. Once the first
          section lands the player takes over and reports its own progress. */}
      {isReady && showPlayer && audio.isPreparing && (
        <div className="mt-6">
          <GenerationProgress
            generation={audio.generation}
            stageLabels={AUDIO_STAGE_LABELS}
            title="Recording this lesson"
            idleLabel="Getting started"
          />
        </div>
      )}

      {isReady && audio.error && !audio.hasAudio && (
        <div className="mt-6">
          <ErrorState title="We couldn't record this lesson" message={audio.error} />
          {!NOT_WORTH_RETRYING.has(audio.errorCode) && (
            <Button className="mt-4" variant="secondary" onClick={audio.retry}>
              Try again
            </Button>
          )}
        </div>
      )}

      {isReady && translation.error && !translation.isPending && (
        <div className="mt-6">
          <ErrorState
            title="We couldn't translate this lesson"
            message={translation.error}
          />
          {!NOT_WORTH_RETRYING.has(translation.errorCode) && (
            <Button className="mt-4" variant="secondary" onClick={translation.retry}>
              Try again
            </Button>
          )}
        </div>
      )}

      {isReady && (
        <>
          <div className="mt-8">
            <BlockRenderer
              // Remounts on a language switch so every block renders from the
              // new content rather than diffing across two languages — which
              // would leave a code block's "Copied" state and a half-typed
              // answer attached to text they no longer belong to.
              key={showingHinglish ? 'hinglish' : 'english'}
              blocks={displayContent}
              quizByQuestionId={quizByQuestionId}
              onAnswer={answerQuestion}
            />
          </div>

          <div className="mt-10">
            <QuizSummary quiz={quiz} />
          </div>

          {/* Mounted as soon as one section is playable, not when the whole
              lesson is done — listening starts while the rest is still being
              recorded, which is the entire point of segmenting it. */}
          {showPlayer && audio.hasAudio && (
            <AudioPlayer
              // Every section, not just the recorded ones, so the track list can
              // show what is still coming and the player knows to park rather
              // than stop when it reaches one.
              segments={audio.segments}
              isGenerating={audio.isGenerating}
              totalExpected={audio.segments.length}
              onClose={() => setShowPlayer(false)}
            />
          )}
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
          {/* Skipping means "move on WITHOUT recording this as done", so it only
              belongs on a lesson that is not finished yet. Shown alongside a
              completed lesson it did exactly what the primary button did, which
              is what made the pair confusing. */}
          {navigation?.next && !lesson.completed && (
            <Button variant="secondary" onClick={() => goTo(navigation.next)}>
              Skip for now
            </Button>
          )}

          {/* Completing a lesson the reader cannot have read would inflate their
              progress, which the backend rejects with LESSON_NOT_READY anyway. */}
          <Button
            onClick={handleComplete}
            disabled={!isReady || (lesson.completed && !navigation?.next)}
            loading={isCompleting}
          >
            {lesson.completed
              ? navigation?.next
                ? 'Next lesson →'
                : 'Completed'
              : navigation?.next
                ? 'Mark complete & continue'
                : 'Mark complete'}
          </Button>
        </div>
      </nav>
    </article>

      {showTutor && (
        <TutorPanel
          courseId={courseId}
          lessonId={lessonId}
          lessonReady={isReady}
          onClose={() => setShowTutor(false)}
        />
      )}
    </div>
  );
}
