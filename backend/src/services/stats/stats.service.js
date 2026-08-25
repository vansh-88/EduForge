import { Course, CourseProgress, LessonQuizAttempt } from '../../models/index.js';

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
export async function computeUserStats(userId) {
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
