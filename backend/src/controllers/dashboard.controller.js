import { Course, CourseProgress, Lesson } from '../models/index.js';
import { toUserDTO } from '../serializers/user.serializer.js';
import { computeProgress } from '../services/progress/progress.service.js';
import { computeUserStats } from '../services/stats/stats.service.js';

const CONTINUE_LIMIT = 5;
const RECENT_LIMIT = 5;

const toCourseCard = (course) => ({
  id: String(course._id),
  title: course.title ?? null,
  query: course.query,
  description: course.description ?? null,
  difficulty: course.difficulty,
  status: course.status,
  moduleCount: course.moduleCount,
  lessonCount: course.lessonCount,
  createdAt: course.createdAt,
});

const COURSE_CARD_FIELDS = 'title query description difficulty status moduleCount lessonCount createdAt';

/**
 * The courses this user most recently opened, each with a deep link back to the exact
 * lesson they left off on.
 *
 * Three queries, never N+1: progress rows, then their courses, then the lessons those
 * rows point at. The lesson lookup is unavoidable because CourseProgress stores only
 * `lastVisitedLesson` and a deep link also needs its moduleId — which means existence
 * validation comes free.
 */
async function buildContinueLearning(userId) {
  const progressRows = await CourseProgress.find({ user: userId, lastVisitedAt: { $ne: null } })
    .sort({ lastVisitedAt: -1 })
    .limit(CONTINUE_LIMIT)
    .lean();

  if (progressRows.length === 0) return [];

  const courseIds = progressRows.map((row) => row.course);
  const lessonIds = progressRows.map((row) => row.lastVisitedLesson).filter(Boolean);

  const [courses, lessons] = await Promise.all([
    // The creator clause keeps ownership enforced even if a progress row outlived its
    // course.
    Course.find({ _id: { $in: courseIds }, creator: userId }).select(COURSE_CARD_FIELDS).lean(),
    lessonIds.length
      ? Lesson.find({ _id: { $in: lessonIds } }).select('_id module title').lean()
      : [],
  ]);

  const courseById = new Map(courses.map((course) => [String(course._id), course]));
  const lessonById = new Map(lessons.map((lesson) => [String(lesson._id), lesson]));

  return progressRows.flatMap((row) => {
    const course = courseById.get(String(row.course));
    if (!course) return []; // course gone; drop the stale row rather than emitting a dead card

    const lesson = row.lastVisitedLesson ? lessonById.get(String(row.lastVisitedLesson)) : null;

    return [{
      course: toCourseCard(course),
      progress: computeProgress(course, row),
      // Null when the lesson is unresolvable. Not reachable today — lessons only exist
      // once a course is READY and a READY course is terminal — but the lookup above
      // proves it rather than assuming it.
      resume: lesson
        ? {
            courseId: String(course._id),
            moduleId: String(lesson.module),
            lessonId: String(lesson._id),
            lessonTitle: lesson.title,
          }
        : null,
      lastVisitedAt: row.lastVisitedAt,
    }];
  });
}

/**
 * Newest courses first, with progress attached in one extra query — the same pattern
 * listCourses uses.
 */
async function buildRecentCourses(userId) {
  const courses = await Course.find({ creator: userId })
    .select(COURSE_CARD_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .limit(RECENT_LIMIT)
    .lean();

  if (courses.length === 0) return [];

  const progressRows = await CourseProgress.find({
    user: userId,
    course: { $in: courses.map((course) => course._id) },
  }).lean();

  const progressByCourse = new Map(progressRows.map((row) => [String(row.course), row]));

  return courses.map((course) => ({
    ...toCourseCard(course),
    progress: computeProgress(course, progressByCourse.get(String(course._id))),
  }));
}

export const getDashboard = async (req, res) => {
  const userId = req.user._id;

  // Independent sections, so one round of parallel queries rather than three serial ones.
  const [continueLearning, stats, recentCourses] = await Promise.all([
    buildContinueLearning(userId),
    computeUserStats(userId),
    buildRecentCourses(userId),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      // No DB hit — attachUser already resolved the caller.
      user: toUserDTO(req.user),
      continueLearning,
      stats,
      recentCourses,
    },
  });
};
