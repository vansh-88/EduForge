import { Spinner, ProgressBar, Button } from '../common';

/**
 * Renders whatever useGenerationStream is reporting, for a course or a lesson.
 *
 * Progress comes from the backend's own stage weights, never from a timer — a
 * bar that advances on its own would keep moving after a worker died.
 */
export const GenerationProgress = ({
  generation,
  stageLabels,
  title = 'Generating',
  idleLabel = 'Starting up',
  onRetry,
  isRetrying = false,
}) => {
  const { status, stage, progress, attempt, maxAttempts, lastError } = generation;

  if (status === 'failed') {
    return (
      <div className="rounded-lg border border-danger-line bg-danger-soft p-6">
        <h3 className="font-semibold text-danger-strong">Generation failed</h3>

        <p className="mt-1 text-sm text-danger-text">
          {lastError || 'Something went wrong while generating this content.'}
        </p>

        {maxAttempts != null && attempt > 0 && (
          <p className="mt-2 text-xs text-danger-text">
            Failed after {attempt} of {maxAttempts} attempts.
          </p>
        )}

        {onRetry && (
          <Button
            variant="secondary"
            className="mt-4"
            onClick={onRetry}
            loading={isRetrying}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  // Before the first event lands there is no stage yet, but the request was
  // already accepted — so this reads as "starting", not as an empty state.
  const stageLabel = (stage && stageLabels[stage]) || idleLabel;
  const isRetryAttempt = status === 'retrying';

  return (
    <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Spinner size="sm" className="text-primary-text" />
        <h3 className="font-semibold text-ink">{title}</h3>
      </div>

      <ProgressBar className="mt-4" value={progress} label={stageLabel} />

      {isRetryAttempt && maxAttempts != null && (
        <p className="mt-3 text-xs text-warn-text">
          Hit a snag — retrying (attempt {attempt} of {maxAttempts}).
        </p>
      )}

      <p className="mt-3 text-xs text-faint">
        This usually takes under a minute. You can safely leave this page and
        come back.
      </p>
    </div>
  );
};
