import { VideoSlot, OutboxEvent } from '../../models/index.js';
import {
  VIDEO_RETRY_MAX_ROUNDS,
  VIDEO_RETRY_COOLDOWN_MS,
} from '../../config/env.config.js';
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
 * Revives this lesson's permanently-failed video slots, if enough time has passed.
 *
 * FAILED is terminal by design — a slot that has burned its attempts must not be
 * retried on every page view, or one unresolvable query would cost 100 quota
 * units per reader. But terminal-forever is wrong too: slots that failed during
 * an outage (a revoked key, a quota wall, the API down for an afternoon) would
 * stay blank permanently, with nothing in the system able to fix them.
 *
 * So revival is bounded on both axes — at most VIDEO_RETRY_MAX_ROUNDS times, and
 * never within VIDEO_RETRY_COOLDOWN_MS of the last failure.
 *
 * Called fire-and-forget from getLesson, the same way lesson lookahead is. That
 * makes it demand-driven: quota is only ever spent retrying lessons somebody is
 * actually reading, rather than draining a backlog nobody will look at.
 *
 * Returns the number of slots revived.
 */
export async function retryFailedSlots(lessonId) {
  const cutoff = new Date(Date.now() - VIDEO_RETRY_COOLDOWN_MS);

  const candidates = await VideoSlot.find({
    lesson: lessonId,
    status: 'FAILED',
    retryRound: { $lt: VIDEO_RETRY_MAX_ROUNDS },
    resolvedAt: { $lt: cutoff },
  }).lean();

  if (candidates.length === 0) return 0;

  let revived = 0;

  for (const candidate of candidates) {
    // Compare-and-swap on the exact round we read, so two concurrent readers of
    // the same lesson cannot both revive the same slot and double-spend quota.
    const claimed = await VideoSlot.findOneAndUpdate(
      { _id: candidate._id, status: 'FAILED', retryRound: candidate.retryRound },
      {
        $set: { status: 'PENDING', lastError: null, generationId: null, attempts: 0 },
        $inc: { retryRound: 1 },
      },
      { returnDocument: 'after' }
    );

    if (!claimed) continue;

    // Dispatched through the outbox rather than enqueued directly: the slot is
    // now PENDING and therefore unsettled, which holds the lesson's SSE stream
    // open. A dropped enqueue would leave it waiting on a job that does not
    // exist, so dispatch has to be durable.
    await OutboxEvent.create({
      eventId: `video-slot-${claimed.slotId}-retry-${claimed.retryRound}`,
      type: 'VIDEO_SLOT_RESOLUTION_REQUESTED',
      aggregateType: 'VideoSlot',
      aggregateId: lessonId,
      payload: {
        lessonId: String(lessonId),
        courseId: String(claimed.course),
        slotId: claimed.slotId,
      },
    });

    revived += 1;
  }

  return revived;
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
