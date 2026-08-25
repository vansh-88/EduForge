import {
  User, Course, Module, Lesson, CourseProgress, LessonQuizAttempt, OutboxEvent, IdempotencyKey,
} from '../../models/index.js';
import { publishCourseDeleted } from '../realtime/generationEvents.js';
import { destroyAvatar, avatarPublicId } from '../media/avatar.service.js';

/**
 * Hard-deletes everything this account owns.
 *
 * Follows the same shape as deleteCourse: collect ids BEFORE deleting, run the deletes
 * together, then publish so any live SSE stream closes.
 *
 * Note the Auth0 identity is untouched — signing in again JIT-provisions a fresh, empty
 * user. That is the right outcome for "delete my data", but it does mean this is not an
 * identity deletion.
 */
export async function deleteUserAccount(user) {
  const userId = user._id;

  // Ids must be gathered before the documents disappear.
  const courseIds = await Course.find({ creator: userId }).distinct('_id');
  const moduleIds = await Module.find({ course: { $in: courseIds } }).distinct('_id');
  const lessonIds = await Lesson.find({ module: { $in: moduleIds } }).distinct('_id');

  await Promise.all([
    Lesson.deleteMany({ module: { $in: moduleIds } }),
    Module.deleteMany({ course: { $in: courseIds } }),
    Course.deleteMany({ _id: { $in: courseIds } }),

    // Both clauses matter: this user's progress anywhere, and anyone's progress on a
    // course that is about to stop existing.
    CourseProgress.deleteMany({ $or: [{ user: userId }, { course: { $in: courseIds } }] }),
    LessonQuizAttempt.deleteMany({ $or: [{ user: userId }, { course: { $in: courseIds } }] }),

    // PROCESSING is included because the outbox publisher rescues stale rows after
    // OUTBOX_LOCK_TIME_MS and would otherwise re-dispatch work for deleted documents.
    OutboxEvent.deleteMany({
      aggregateId: { $in: [...courseIds, ...lessonIds] },
      status: { $in: ['PENDING', 'PROCESSING'] },
    }),

    // This model stores userId as a String while everything else uses ObjectId;
    // Mongoose casts on the way in, so the match still works.
    IdempotencyKey.deleteMany({ userId }),
  ]);

  // Derived rather than stored: correct regardless of how fresh `user` is, and it also
  // sweeps anything parked under the id through the raw/video upload loophole.
  // Destroying an absent asset is a no-op, so an Auth0-sourced picture costs nothing.
  await destroyAvatar(avatarPublicId(userId));

  await User.deleteOne({ _id: userId });

  // After the cascade, so a client reacting to the event re-fetches into a clean 404
  // rather than racing the deletes. One publish per course closes every stream watching
  // it, including its lessons'.
  await Promise.all(courseIds.map((courseId) => publishCourseDeleted(courseId)));

  return {
    courses: courseIds.length,
    modules: moduleIds.length,
    lessons: lessonIds.length,
  };
}
