import { redisConnection } from '../../config/redis.config.js';

// MongoDB stores the uppercase lifecycle state; clients only ever see these
// lowercase ones. Mapping in a single place is what keeps the SSE snapshot and the
// live events speaking the same vocabulary.
const WIRE_STATUS = {
  PENDING: 'not_started',
  GENERATING: 'generating',
  PROCESSING: 'generating',
  RETRYING: 'retrying',
  READY: 'ready',
  FAILED: 'failed',
};


/**
 * The single definition of a generation event's shape. Accepts either a MongoDB
 * status ('PROCESSING') or an already-normalized one ('generating'), so the worker
 * and the SSE snapshot can both build events through it.
 *
 * stage/progress are always present — a retry must not blank out the client's
 * progress bar just because an attempt failed.
 */
export function toGenerationEvent({
  type,
  status,
  stage = null,
  progress = 0,
  attempt = 0,
  maxAttempts = null,
  lastError = null,
}) {
  const wireStatus = WIRE_STATUS[status] ?? status;

  const event = { type, status: wireStatus, stage, progress, attempt, maxAttempts };

  // Only surface an error string on terminal failure — never mid-retry.
  if (wireStatus === 'failed') event.lastError = lastError;

  return event;
}


export async function publishLessonEvent(lessonId, descriptor) {
  const channel = `lesson:generation:${lessonId}`;

  try {
    await redisConnection.publish(channel, JSON.stringify(toGenerationEvent(descriptor)));
  } catch (error) {
    // Pub/Sub is best-effort live transport: MongoDB is the source of truth and the
    // SSE snapshot recovers anything missed. A Redis blip must never fail — or worse,
    // strand — a generation that is otherwise fine.
    console.error(`[LessonEvents] publish failed lesson=${lessonId}:`, error.message);
  }
}
