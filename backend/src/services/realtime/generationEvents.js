import { redisConnection, redisFailFast } from '../../config/redis.config.js';

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
 * Channel for one lesson's translation into one language.
 *
 * Deliberately NOT the lesson's own generation channel. A translation is
 * requested long after the lesson is READY, by which point that stream has
 * already closed — its terminal condition is "content ready and every video slot
 * settled". Publishing here instead means a translation gets its own short-lived
 * stream with its own terminal condition, and the lesson generation path that
 * already works is left untouched.
 */
export function translationChannel(lessonId, language) {
  return `lesson:translation:${lessonId}:${language}`;
}

/**
 * Channel for one lesson's generated audio.
 *
 * Its own channel for the same reason translations have one: audio is requested
 * after the lesson is READY, when the lesson's generation stream has already
 * reached its terminal state and closed.
 */
export function audioChannel(lessonId) {
  return `lesson:audio:${lessonId}`;
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
    // The fail-fast client: a publish is best-effort live transport, and on the
    // shared BullMQ client an unreachable Redis would park it forever rather than
    // reject it — turning "the client missed an event" into "the worker stopped".
    await redisFailFast.publish(channel, JSON.stringify(event));
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
 * Announces that one video slot has settled — resolved, or definitively not.
 *
 * Published on the lesson's own generation channel rather than a channel of its
 * own, so the reader's existing stream carries it and no second connection is
 * needed.
 *
 * These events describe a sibling resource rather than the lesson's own
 * lifecycle, so they deliberately do NOT go through toGenerationEvent: there is
 * no stage, no progress and no attempt count to report, and forcing them into
 * that shape would mean publishing zeroes that a client could mistake for the
 * lesson's own progress being reset.
 */
export async function publishVideoSlotEvent(lessonId, { slotId, status }) {
  await publishTo(channelFor('lesson', lessonId), {
    type: `video_slot_${status.toLowerCase()}`,
    slotId,
    status: status.toLowerCase(),
  });
}

/**
 * Announces that every video slot on a lesson has settled.
 *
 * This is what actually terminates a lesson's SSE stream. `lesson_generation_completed`
 * no longer does, because enrichment continues after the content is readable —
 * closing there would drop every video update on the floor.
 */
export async function publishEnrichmentCompleted(lessonId) {
  await publishTo(channelFor('lesson', lessonId), {
    type: 'lesson_enrichment_completed',
    status: 'ready',
  });
}

/**
 * Progress on one lesson translation.
 *
 * Unlike the video slot events, these DO go through toGenerationEvent: a
 * translation has its own lifecycle — stage, progress, attempt count, retries —
 * so it has exactly the shape that function exists to describe, and the client
 * can render it with the same GenerationProgress panel a lesson uses.
 */
export async function publishTranslationEvent(lessonId, language, descriptor) {
  await publishTo(translationChannel(lessonId, language), toGenerationEvent(descriptor));
}

/**
 * Progress on one lesson's audio as a whole.
 *
 * Goes through toGenerationEvent — audio has its own lifecycle with stages,
 * progress and retries, exactly the shape that function describes.
 */
export async function publishAudioEvent(lessonId, descriptor) {
  await publishTo(audioChannel(lessonId), toGenerationEvent(descriptor));
}

/**
 * Announces that one segment is playable.
 *
 * This is the event progressive playback is built on: the reader starts
 * listening to section one while the rest are still being synthesized, which
 * matters because the provider needs roughly twelve seconds per sentence.
 *
 * Like the video slot events, it deliberately does NOT go through
 * toGenerationEvent — it describes a sibling resource, not the audio's own
 * lifecycle, and forcing it into that shape would mean publishing a stage and a
 * progress figure that a client could mistake for the whole job resetting.
 *
 * The URL is carried on the event rather than left to a follow-up read: unlike a
 * video slot, a segment is immutable once READY, so there is no risk of the event
 * disagreeing with the database — and making the reader wait for a round trip
 * before audio can start would undo the point of segmenting at all.
 */
export async function publishAudioSegmentEvent(lessonId, { segmentId, sequence, status, audioUrl = null, title = null, durationSeconds = null }) {
  await publishTo(audioChannel(lessonId), {
    type: `audio_segment_${status.toLowerCase()}`,
    segmentId,
    sequence,
    status: status.toLowerCase(),
    audioUrl,
    title,
    durationSeconds,
  });
}

/**
 * SUBSCRIBE puts a connection into subscriber-only mode, so this must never reuse
 * the shared client that BullMQ depends on.
 */
export function subscribeChannels(channels, onEvent) {
  // One connection carries every channel, so watching the course-deleted fan-out
  // alongside a generation channel costs nothing extra.
  const wanted = new Set(channels);
  // Duplicated from the PRIMARY client on purpose, not the fail-fast one. A
  // subscriber is long-lived and wants to ride out a blip and resume: a command
  // timeout on an idle subscription would tear down a stream that is perfectly
  // healthy and merely quiet.
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
