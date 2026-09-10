import { VideoSlot } from '../../models/index.js';
import { resolveVideoForSlot, QuotaExhaustedError } from '../../services/video/videoService.js';
import { settleSlot, announceIfLastSlot } from '../../services/video/videoSlot.service.js';

/**
 * Resolves one video slot to an actual video.
 *
 * The rule this whole pipeline exists to protect: nothing in here may fail the
 * lesson. The lesson is already READY and readable before this job runs, and the
 * worst outcome available to it is a slot the reader never sees.
 */
export async function runVideoSlotResolution({ lessonId, slotId, generationId, job }) {
  const currentAttempt = (job?.attemptsMade || 0) + 1;
  const maxAttempts = job?.opts?.attempts;

  // 1. ATOMIC CLAIM — the same compare-and-swap the lesson processor uses. A slot
  // already RESOLVING under OUR generationId is this job's own stranded claim from
  // a killed worker; anything else bounces off.
  const claimed = await VideoSlot.findOneAndUpdate(
    {
      lesson: lessonId,
      slotId,
      $or: [
        { status: { $in: ['PENDING', 'FAILED'] } },
        { status: 'RESOLVING', generationId },
      ],
    },
    {
      $set: {
        status: 'RESOLVING',
        generationId,
        attempts: currentAttempt,
        maxAttempts,
      },
    },
    { returnDocument: 'after' }
  );

  if (!claimed) {
    // Already READY or UNAVAILABLE — the doc's idempotency rule. Still check
    // whether the lesson is now fully settled: this job may be the duplicate
    // that arrives after the real one finished, and the stream must not be left
    // waiting on a slot nobody is going to announce.
    await announceIfLastSlot(lessonId);
    return { slotId, status: 'SKIPPED' };
  }

  try {
    const { video } = await resolveVideoForSlot({
      primaryQuery: claimed.search.primaryQuery,
      fallbackQuery: claimed.search.fallbackQuery,
      language: claimed.search.language,
    });

    // Searched successfully and found nothing suitable. A valid outcome, not an
    // error — and terminal, since re-running the same query would cost another
    // 100 units to reach the same answer.
    const status = video ? 'READY' : 'UNAVAILABLE';

    await settleSlot({ slotId, lessonId, generationId, status, video });

    return { slotId, status };

  } catch (error) {
    // Budget, not failure. Release the claim so the retry can re-take it, and
    // let the worker reschedule past the reset without consuming an attempt.
    if (error instanceof QuotaExhaustedError) {
      await VideoSlot.updateOne(
        { lesson: lessonId, slotId, status: 'RESOLVING', generationId },
        { $set: { status: 'PENDING', lastError: 'Waiting for daily search quota to reset' } }
      );
      throw error;
    }

    const isFinalAttempt = currentAttempt >= maxAttempts;
    const lastError = `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}`;

    if (isFinalAttempt) {
      await settleSlot({ slotId, lessonId, generationId, status: 'FAILED', lastError });
    } else {
      // Stay unsettled so the lesson's stream keeps waiting for the retry.
      await VideoSlot.updateOne(
        { lesson: lessonId, slotId, status: 'RESOLVING', generationId },
        { $set: { status: 'PENDING', lastError } }
      );
    }

    throw error;
  }
}
