import mongoose from 'mongoose';
import { User, Course, CourseProgress, LessonQuizAttempt, IdempotencyKey } from '../../models/index.js';
import { collectCourseCascadeIds, purgeCourseChildren } from '../course/cascade.js';
import { publishCourseDeleted } from '../realtime/generationEvents.js';
import { destroyAvatar, avatarPublicId } from '../media/avatar.service.js';
import { destroyLessonAudio } from '../media/audio.service.js';

/**
 * Hard-deletes everything this account owns.
 *
 * Note the Auth0 identity is untouched — signing in again JIT-provisions a fresh,
 * empty user. That is the right outcome for "delete my data", but it does mean this
 * is not an identity deletion.
 *
 * The course cascade is deliberately NOT written out here. It used to be, and the
 * copy rotted: this function predates translations and audio and was never updated
 * when they arrived, so deleting an account left every Hinglish translation, every
 * LessonAudio row, every audio segment and every Cloudinary audio file behind with
 * no owner and nothing that would ever find them. It now calls the same cascade the
 * course delete does, so a derived collection added in future is picked up by both
 * or by neither, never by one.
 *
 * One transaction, children first, owners last, for the same reason deleteCourse
 * uses one: an interrupted cascade that has already removed the Course documents
 * leaves orphans nothing can reach, and that has demonstrably happened here before.
 */
export async function deleteUserAccount(user) {
  const userId = user._id;

  const session = await mongoose.startSession();
  let outcome = null;

  try {
    await session.withTransaction(async () => {
      // Re-read on every attempt: withTransaction retries its whole callback on a
      // transient error, so nothing may be carried over from a rolled-back attempt.
      const courseIds = await Course.find({ creator: userId }, null, { session }).distinct('_id');

      const ids = courseIds.length
        ? await collectCourseCascadeIds(courseIds, { session })
        : { moduleIds: [], lessonIds: [], translationIds: [], audioIds: [] };

      if (courseIds.length) {
        await purgeCourseChildren(courseIds, ids, { session });
        await Course.deleteMany({ _id: { $in: courseIds } }, { session });
      }

      // Rows keyed to the USER rather than to a course, which the cascade above does
      // not cover: this account's progress and attempts on any course, including ones
      // it does not own.
      await CourseProgress.deleteMany({ user: userId }, { session });
      await LessonQuizAttempt.deleteMany({ user: userId }, { session });

      // This model stores userId as a String while everything else uses ObjectId;
      // Mongoose casts on the way in, so the match still works.
      await IdempotencyKey.deleteMany({ userId }, { session });

      // Last: the row every other row here was reached from.
      await User.deleteOne({ _id: userId }, { session });

      outcome = { courseIds, lessonIds: ids.lessonIds, moduleCount: ids.moduleIds.length };
    });
  } finally {
    await session.endSession();
  }

  // External side effects, after the commit and best-effort — they cannot be rolled
  // back, so a failure here must not fail a deletion MongoDB has already made.
  //
  // Derived rather than stored: correct regardless of how fresh `user` is, and it
  // also sweeps anything parked under the id through the raw/video upload loophole.
  // Destroying an absent asset is a no-op, so an Auth0-sourced picture costs nothing.
  await destroyAvatar(avatarPublicId(userId));

  // The lesson audio this account paid to generate. Missing entirely before, so a
  // deleted account's narration stayed in Cloudinary indefinitely.
  await Promise.all(outcome.lessonIds.map((lessonId) => destroyLessonAudio(lessonId)));

  // After the cascade, so a client reacting to the event re-fetches into a clean 404
  // rather than racing the deletes. One publish per course closes every stream
  // watching it, including its lessons'.
  await Promise.all(outcome.courseIds.map((courseId) => publishCourseDeleted(courseId)));

  return {
    courses: outcome.courseIds.length,
    modules: outcome.moduleCount,
    lessons: outcome.lessonIds.length,
  };
}
