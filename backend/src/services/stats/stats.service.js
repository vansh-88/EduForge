import { Course, CourseProgress, LessonQuizAttempt } from '../../models/index.js';
import { cached, invalidateCache } from '../cache/cache.js';
import { STATS_CACHE_TTL_SECONDS } from '../../config/env.config.js';

// The in-flight statuses collapse into one bucket: a user browsing a dashboard cares
// that a course is still being built, not which internal phase it is in.
const IN_FLIGHT = ['GENERATING', 'PROCESSING', 'RETRYING'];

/**
 * Every learning statistic for one user, in a single reusable place — the dashboard
 * and the profile page must never disagree about these numbers.
 *
 * Uses aggregation rather than loading documents: counting lessons completed and quiz
 * answers otherwise means pulling every progress and attempt document into memory.
 */
async function computeUserStatsUncached(userId) {
  const [courseRows, progressRows, quizRows] = await Promise.all([
    // One pass gives the total, the status breakdown, and the lesson denominator.
    Course.aggregate([
      { $match: { creator: userId } },
      { $group: { _id: '$status', count: { $sum: 1 }, lessons: { $sum: '$lessonCount' } } },
    ]),

    // A CourseProgress row is created the first time a course is merely *viewed*
    // (getOrCreateProgress), so "started" must test for actual completed lessons
    // rather than the row's existence.
    CourseProgress.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          completedCourses: { $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] } },
          startedCourses: { $sum: { $cond: [{ $gt: [{ $size: '$completedLessons' }, 0] }, 1, 0] } },
          lessonsCompleted: { $sum: { $size: '$completedLessons' } },
        },
      },
    ]),

    // `answers` is a Mongoose Map, which BSON stores as a plain embedded document, so
    // $objectToArray turns it into {k, v} pairs. It throws on a missing field, hence
    // the $ifNull guard.
    LessonQuizAttempt.aggregate([
      { $match: { user: userId } },
      { $project: { entries: { $objectToArray: { $ifNull: ['$answers', {}] } } } },
      {
        $group: {
          _id: null,
          answered: { $sum: { $size: '$entries' } },
          correct: { $sum: { $size: { $filter: { input: '$entries', cond: '$$this.v.correct' } } } },
        },
      },
    ]),
  ]);

  const byStatus = new Map(courseRows.map((row) => [row._id, row]));
  const countOf = (status) => byStatus.get(status)?.count ?? 0;

  const created = courseRows.reduce((total, row) => total + row.count, 0);
  const totalLessons = courseRows.reduce((total, row) => total + (row.lessons ?? 0), 0);

  const progress = progressRows[0] ?? { completedCourses: 0, startedCourses: 0, lessonsCompleted: 0 };
  const quiz = quizRows[0] ?? { answered: 0, correct: 0 };

  const completedCourses = progress.completedCourses;
  // A completed course is also a started one, so subtract to avoid counting it twice.
  const inProgress = Math.max(progress.startedCourses - completedCourses, 0);

  return {
    courses: {
      created,
      completed: completedCourses,
      inProgress,
      // Clamped: progress rows can outlive their course if one is removed outside the
      // cascade, which would otherwise drive this negative.
      notStarted: Math.max(created - completedCourses - inProgress, 0),
    },
    courseStatus: {
      ready: countOf('READY'),
      generating: IN_FLIGHT.reduce((total, status) => total + countOf(status), 0),
      failed: countOf('FAILED'),
    },
    lessons: {
      completed: progress.lessonsCompleted,
      total: totalLessons,
    },
    quiz: {
      answered: quiz.answered,
      correct: quiz.correct,
      accuracy: quiz.answered > 0 ? Math.round((quiz.correct / quiz.answered) * 100) : 0,
    },
  };
}


const statsCacheKey = (userId) => `stats:user:${userId}`;

/**
 * Every learning statistic for one user, cached briefly.
 *
 * The only read in the application expensive enough to be worth caching: three
 * aggregations, and both the dashboard and the profile page ask for it, so a
 * single page view can run it twice. Everything else here is one indexed query
 * against one user's own documents, where a cache would buy little and add an
 * invalidation path to every write.
 *
 * The TTL is short and the cache is invalidated on the two writes that actually
 * move the numbers, so a reader who finishes a lesson sees it reflected at once
 * rather than up to a minute later. The TTL is the backstop for anything else
 * that touches the underlying documents — a deleted course, say — which is why
 * it exists even though the explicit invalidation covers the common cases.
 */
export async function computeUserStats(userId) {
  return cached(
    statsCacheKey(userId),
    STATS_CACHE_TTL_SECONDS,
    () => computeUserStatsUncached(userId)
  );
}

/** Called from the writes that change what the statistics report. */
export async function invalidateUserStats(userId) {
  await invalidateCache(statsCacheKey(userId));
}
