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
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h3 className="font-semibold text-red-900">Generation failed</h3>

        <p className="mt-1 text-sm text-red-700">
          {lastError || 'Something went wrong while generating this content.'}
        </p>

        {maxAttempts != null && attempt > 0 && (
          <p className="mt-2 text-xs text-red-600">
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
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Spinner size="sm" className="text-blue-600" />
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>

      <ProgressBar className="mt-4" value={progress} label={stageLabel} />

      {isRetryAttempt && maxAttempts != null && (
        <p className="mt-3 text-xs text-amber-600">
          Hit a snag — retrying (attempt {attempt} of {maxAttempts}).
        </p>
      )}

      <p className="mt-3 text-xs text-gray-400">
        This usually takes under a minute. You can safely leave this page and
        come back.
      </p>
    </div>
  );
};
