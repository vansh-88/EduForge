import { VideoSlot } from '../../models/index.js';
import {
  publishVideoSlotEvent,
  publishEnrichmentCompleted,
} from '../realtime/generationEvents.js';

// Slot states that still have something to publish. Mirrors the list the SSE
// controller uses to decide whether a lesson's stream may close.
export const UNSETTLED_STATUSES = ['PENDING', 'RESOLVING'];

/**
 * Records a slot's final state and announces it.
 *
 * Every terminal transition goes through here, so the rule that ends a lesson's
 * SSE stream lives in exactly one place: whoever settles the *last* outstanding
 * slot is responsible for saying so. Splitting that across the worker's success
 * and failure paths is how a stream ends up heartbeating forever.
 *
 * The status write is guarded by the caller's own claim, so a job that lost its
 * claim to a newer cycle cannot overwrite the winner's result.
 */
export async function settleSlot({
  slotId,
  lessonId,
  generationId,
  status,
  video = null,
  lastError = null,
  force = false,
}) {
  // `force` is for the worker's last-resort release only. A job that stalls
  // before the processor claims the slot leaves it PENDING under no
  // generationId, so the normal guard matches nothing — and an unsettled slot
  // with no job behind it holds the lesson's SSE stream open forever. Forcing
  // matches any unsettled state instead.
  const claim = force
    ? { lesson: lessonId, slotId, status: { $in: UNSETTLED_STATUSES } }
    : { lesson: lessonId, slotId, status: 'RESOLVING', generationId };

  const settled = await VideoSlot.findOneAndUpdate(
    claim,
    {
      $set: {
        status,
        video: video ?? {
          provider: null, videoId: null, title: null,
          channelTitle: null, thumbnailUrl: null, durationSeconds: null,
        },
        lastError,
        resolvedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  // Someone else owns this slot now — they will publish their own result.
  if (!settled) return null;

  await publishVideoSlotEvent(lessonId, { slotId, status });

  await announceIfLastSlot(lessonId);

  return settled;
}

/**
 * Publishes `lesson_enrichment_completed` once nothing is outstanding.
 *
 * Safe to call more than once: it is a no-op while slots remain, and a duplicate
 * publish after the stream has closed goes nowhere.
 */
export async function announceIfLastSlot(lessonId) {
  const remaining = await VideoSlot.countDocuments({
    lesson: lessonId,
    status: { $in: UNSETTLED_STATUSES },
  });

  if (remaining > 0) return false;

  await publishEnrichmentCompleted(lessonId);
  return true;
}
