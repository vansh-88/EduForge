import { CourseProgress } from '../../models/index.js';

/**
 * Single source of truth for progress numbers. Pure — no DB access — so the
 * course list, overview, learn, and dashboard endpoints all agree.
 */
export function computeProgress(course, progress) {
  const totalLessons = course?.lessonCount ?? 0;
  const completedIds = progress?.completedLessons ?? [];

  // A course retry rebuilds modules and lessons, orphaning IDs already in
  // completedLessons. Clamp so percentage can never exceed 100.
  const completedLessons = Math.min(completedIds.length, totalLessons);

  const percentage =
    totalLessons === 0 ? 0 : Math.floor((completedLessons / totalLessons) * 100);

  let status;
  if (completedLessons === 0) status = 'not_started';
  else if (completedLessons >= totalLessons) status = 'completed';
  else status = 'in_progress';

  return {
    completedLessons,
    totalLessons,
    percentage,
    status,
    lastVisitedLessonId: progress?.lastVisitedLesson
      ? String(progress.lastVisitedLesson)
      : null,
  };
}

export async function getOrCreateProgress(userId, courseId) {
  try {
    return await CourseProgress.findOneAndUpdate(
      { user: userId, course: courseId },
      { $setOnInsert: { user: userId, course: courseId } },
      { upsert: true,  returnDocument: 'after' }
    );
  } catch (error) {
    // Same upsert race as attachUser: concurrent first-requests, one wins.
    if (error.code !== 11000) throw error;
    return CourseProgress.findOne({ user: userId, course: courseId });
  }
}

export async function markLessonComplete({ userId, course, lessonId }) {
  let progress = await CourseProgress.findOneAndUpdate(
    { user: userId, course: course._id },
    { $addToSet: { completedLessons: lessonId } },
    { upsert: true, returnDocument: 'after' }
  );

  const summary = computeProgress(course, progress);

  // Stamp the finish time exactly once, on the transition into 'completed'.
  // The completedAt:null filter makes this safe under concurrent requests.
  if (summary.status === 'completed' && !progress.completedAt) {
    progress =
      (await CourseProgress.findOneAndUpdate(
        { _id: progress._id, completedAt: null },
        { $set: { completedAt: new Date() } },
        { returnDocument: 'after' }
      )) ?? progress;
  }

  return { progress, summary };
}

export async function touchLastVisited({ userId, courseId, lessonId }) {
  try {
    await CourseProgress.updateOne(
      { user: userId, course: courseId },
      { $set: { lastVisitedLesson: lessonId, lastVisitedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    // Read-position tracking must never fail the request it rides along with.
    if (error.code !== 11000) throw error;
  }
}