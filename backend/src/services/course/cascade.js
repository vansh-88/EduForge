import {
  Module, Lesson, CourseProgress, LessonQuizAttempt, VideoSlot, LessonTranslation,
  LessonAudio, LessonAudioSegment, ChatSession, ChatMessage, CourseChunk, OutboxEvent,
} from '../../models/index.js';

/**
 * Everything that belongs to a course, and how to remove it.
 *
 * ONE definition, used by both paths that can destroy a course — deleting a course
 * and deleting an account. They used to carry a copy each, and the copies drifted:
 * the account path was written before translations and audio existed and was never
 * updated, so deleting an account left every Hinglish translation, audio row and
 * audio segment behind forever. That is the failure this module exists to make
 * impossible — a new derived collection is added here once, and both paths get it.
 *
 * Nothing here deletes the Course document itself. That is deliberate and is the
 * other half of the design: the course id is the only handle on all of this data,
 * so it must be the LAST thing removed. Delete it first — as both paths used to —
 * and any interruption before the children are gone leaves orphans that nothing can
 * ever find again. Children first, course last, means an interrupted delete leaves
 * a course that is merely still there, and deleting it again finishes the job.
 */

/**
 * Collects the ids needed to purge a set of courses.
 *
 * Read before anything is deleted, because most of these are only reachable through
 * documents the purge is about to remove.
 */
export async function collectCourseCascadeIds(courseIds, { session } = {}) {
  const moduleIds = await Module.find({ course: { $in: courseIds } }, null, { session }).distinct('_id');
  const lessonIds = await Lesson.find({ module: { $in: moduleIds } }, null, { session }).distinct('_id');

  // Translations and audio publish their SSE events under their OWN ids rather than
  // the lesson's, so their outbox rows cannot be found by lesson id.
  const translationIds = await LessonTranslation.find({ course: { $in: courseIds } }, null, { session }).distinct('_id');
  const audioIds = await LessonAudio.find({ course: { $in: courseIds } }, null, { session }).distinct('_id');

  return { moduleIds, lessonIds, translationIds, audioIds };
}

/**
 * Deletes everything owned by `courseIds` except the Course documents themselves.
 *
 * Runs inside the caller's transaction, so the whole cascade commits or none of it
 * does. Sequential rather than Promise.all: a transaction is bound to one session,
 * and firing its operations concurrently on the same session is not something the
 * driver supports. Concurrency bought nothing here anyway — the previous code's
 * Promise.all is precisely what let some deletes land while others never ran.
 */
export async function purgeCourseChildren(courseIds, ids, { session }) {
  const { moduleIds, lessonIds, translationIds, audioIds } = ids;
  const byCourse = { course: { $in: courseIds } };

  await Lesson.deleteMany({ module: { $in: moduleIds } }, { session });
  await Module.deleteMany(byCourse, { session });
  await CourseProgress.deleteMany(byCourse, { session });
  await LessonQuizAttempt.deleteMany(byCourse, { session });

  // Slots, translations, audio, chat and chunks are all denormalized with their
  // course id precisely so each of these is one query rather than a walk down
  // through modules and lessons.
  await VideoSlot.deleteMany(byCourse, { session });
  await LessonTranslation.deleteMany(byCourse, { session });
  await LessonAudio.deleteMany(byCourse, { session });
  await LessonAudioSegment.deleteMany(byCourse, { session });
  await ChatSession.deleteMany(byCourse, { session });
  await ChatMessage.deleteMany(byCourse, { session });
  await CourseChunk.deleteMany(byCourse, { session });

  // Drop work not yet dispatched, for the course and for every aggregate under it —
  // events are keyed by the aggregate's own id, not the course's. PROCESSING is
  // included because the publisher rescues stale PROCESSING rows after
  // OUTBOX_LOCK_TIME_MS and would otherwise re-dispatch one. Jobs already running
  // bounce off their claim harmlessly, since the documents no longer exist.
  await OutboxEvent.deleteMany(
    {
      aggregateId: { $in: [...courseIds, ...lessonIds, ...translationIds, ...audioIds] },
      status: { $in: ['PENDING', 'PROCESSING'] },
    },
    { session }
  );
}
