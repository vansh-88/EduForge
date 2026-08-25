import { redisConnection } from '../../config/redis.config.js';

// MongoDB stores the uppercase lifecycle state; clients only ever see these
// lowercase ones. Mapping in a single place is what keeps the SSE snapshot and the
// live events speaking the same vocabulary — for courses and lessons alike.
const WIRE_STATUS = {
  PENDING: 'not_started',
  GENERATING: 'generating',
  PROCESSING: 'generating',
  RETRYING: 'retrying',
  READY: 'ready',
  FAILED: 'failed',
};

/**
 * Channel name for a generation stream. `kind` is 'lesson' | 'course'.
 * The lesson form is byte-identical to what it was before this module was
 * generalized, so existing subscribers keep working.
 */
export function channelFor(kind, id) {
  return `${kind}:generation:${id}`;
}

/**
 * Fan-out topic for "this course no longer exists".
 *
 * Every stream belonging to a course — the course's own, and each of its lessons' —
 * subscribes to this alongside its generation channel. Deleting a course is then a
 * single publish instead of one per lesson: a reader only ever watches one lesson at
 * a time, so per-lesson publishing would fan out to channels nobody is listening on.
 */
export function courseDeletedChannel(courseId) {
  return `course:${courseId}:deleted`;
}

/**
 * The single definition of a generation event's shape. Accepts either a MongoDB
 * status ('PROCESSING') or an already-normalized one ('generating'), so workers and
 * SSE snapshots can both build events through it.
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

/**
 * The one place Pub/Sub failures are swallowed. It is best-effort live transport:
 * MongoDB is the source of truth and the SSE snapshot recovers anything missed, so a
 * Redis blip must never fail — or worse, strand — a generation that is otherwise fine.
 */
async function publishTo(channel, event) {
  try {
    await redisConnection.publish(channel, JSON.stringify(event));
  } catch (error) {
    console.error(`[GenerationEvents] publish failed on ${channel}:`, error.message);
  }
}


export async function publishGenerationEvent(kind, id, descriptor) {
  await publishTo(channelFor(kind, id), toGenerationEvent(descriptor));
}


/**
 * Announces that a course and everything under it is gone. A single publish closes
 * every stream watching that course — its own and each of its lessons' — because they
 * all subscribe to the fan-out channel.
 *
 * Without this, a stream open at delete time heartbeats forever holding a Redis
 * subscriber, and a worker already past its claim keeps publishing progress to the
 * same channel, so the client watches a deleted course appear to advance.
 *
 * 'deleted' is not in WIRE_STATUS and passes through untouched.
 */
export async function publishCourseDeleted(courseId) {
  await publishTo(
    courseDeletedChannel(courseId),
    toGenerationEvent({ type: 'course_deleted', status: 'deleted' })
  );
}

/**
 * SUBSCRIBE puts a connection into subscriber-only mode, so this must never reuse
 * the shared client that BullMQ depends on.
 */
export function subscribeChannels(channels, onEvent) {
  // One connection carries every channel, so watching the course-deleted fan-out
  // alongside a generation channel costs nothing extra.
  const wanted = new Set(channels);
  const subscriber = redisConnection.duplicate();

  subscriber.on('message', (receivedChannel, message) => {
    if (!wanted.has(receivedChannel)) return;
    try {
      onEvent(JSON.parse(message));
    } catch {
      // Malformed payload — drop it, never crash the stream over one bad message.
    }
  });

  return {
    subscribed: subscriber.subscribe(...wanted),
    close: () => subscriber.quit(),
  };
}


/** Single-channel convenience wrapper. */
export function subscribeGenerationEvents(kind, id, onEvent) {
  return subscribeChannels([channelFor(kind, id)], onEvent);
}
