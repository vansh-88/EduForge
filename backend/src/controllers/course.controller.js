import crypto from 'node:crypto';
import { generateCourseRequestSchema } from '../schemas/index.js';
import { newCourseGeneration, retryCourseGeneration as retryCourseGenerationService } from '../services/course/course.service.js';
import { Course, Module, Lesson, CourseProgress, LessonQuizAttempt, OutboxEvent } from '../models/index.js';
import mongoose from 'mongoose';
import { computeProgress, getOrCreateProgress } from '../services/progress/progress.service.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { publishCourseDeleted } from '../services/realtime/generationEvents.js';


function hashRequest(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}


export const generateCourse = async (req, res) => {
  const userId = req.user._id;

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
  }

  //topic and difficulty already validated by the middleware.
  const { topic, difficulty } = req.validated.body;

  // Hashing the whole validated body for idempotency key
  const requestHash = hashRequest(req.validated.body);

  // Delegate to the pure service
  const result = await newCourseGeneration({
    userId,
    topic,
    difficulty,
    idempotencyKey,
    requestHash
  });

  // Option to add a header so clients know if they hit the cache
  if (result.isCached) {
    res.set('X-Idempotency-Replayed', 'true');
  }

  return res.status(result.statusCode).json(result.data);
};


export const listCourses = async (req, res) => {
  const userId = req.user._id;

  // Pagination and filters already validated/coerced by the middleware.
  const { page, limit, search, status, difficulty, tags } = req.validated.query;

  const filter = { creator: userId };

  // One search box across BOTH the user's original prompt and the generated title.
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: pattern }, { query: pattern }];
  }

  if (status) filter.status = status;
  if (difficulty) filter.difficulty = difficulty;
  if (tags) filter.tags = { $in: tags };

  const skip = (page - 1) * limit;

  const [courses, total] = await Promise.all([
    Course.find(filter)
      .select('query title description status tags difficulty moduleCount lessonCount createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    Course.countDocuments(filter),
  ]);

  // Attach progress for the page in ONE query rather than per course.
  const progressDocs = courses.length
    ? await CourseProgress.find({ user: userId, course: { $in: courses.map((c) => c._id) } }).lean()
    : [];

  const progressByCourse = new Map(progressDocs.map((doc) => [String(doc.course), doc]));

  const coursesWithProgress = courses.map((course) => ({
    ...course,
    progress: computeProgress(course, progressByCourse.get(String(course._id))),
  }));

  const totalPages = Math.ceil(total / limit);

  return res.status(200).json({
    success: true,
    data: {
      courses: coursesWithProgress,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    },
  });
};


export const getCourseById = async (req, res) => {
  const userId = req.user._id;
  const { courseId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  const course = await Course.findOne({ _id: courseId, creator: userId })
    .populate({
      path: 'modules',
      select: 'title goal order',
      populate: {
        path: 'lessons',
        select: 'title order status objectives attempts maxAttempts stage progress',
      },
    })
    .lean();

  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  if (Array.isArray(course.modules)) {
    course.modules.sort((a, b) => a.order - b.order);
    for (const module of course.modules) {
      if (Array.isArray(module.lessons)) {
        module.lessons.sort((a, b) => a.order - b.order);
      }
    }
  }

  const progress = await getOrCreateProgress(userId, courseId);
  const progressSummary = computeProgress(course, progress);

  return res.status(200).json({
    success: true,
    data: { course, progress: progressSummary },
  });
};


export const retryCourseGeneration = async (req, res) => {

  const userId = req.user._id;

  const { courseId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
  }

  const requestHash = hashRequest({ courseId });

  const result = await retryCourseGenerationService({
    userId, courseId, idempotencyKey, requestHash,
  });

  if (result.isCached) {
    res.set('X-Idempotency-Replayed', 'true');
  }

  return res.status(result.statusCode).json(result.data);

};


export const deleteCourse = async (req, res) => {
  const userId = req.user._id;
  const { courseId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  // Ownership is proven by the delete filter itself, so there is no window between
  // checking and removing.
  const course = await Course.findOneAndDelete({ _id: courseId, creator: userId });

  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  // Cascade. Lessons are found via their modules, so collect module ids first — and
  // the lesson ids before they are removed, since each may have an open SSE stream
  // and its own queued generation work.
  const moduleIds = await Module.find({ course: course._id }).distinct('_id');
  const lessonIds = await Lesson.find({ module: { $in: moduleIds } }).distinct('_id');

  await Promise.all([
    Lesson.deleteMany({ module: { $in: moduleIds } }),
    Module.deleteMany({ course: course._id }),
    CourseProgress.deleteMany({ course: course._id }),
    LessonQuizAttempt.deleteMany({ course: course._id }),
    // Drop generation work not yet dispatched, for the course and for every lesson
    // (lesson events are keyed by lessonId, not courseId). PROCESSING is included
    // because the publisher rescues stale PROCESSING rows after OUTBOX_LOCK_TIME_MS
    // and would otherwise re-dispatch one. Already-running jobs bounce off the claim
    // harmlessly, since the documents no longer exist.
    OutboxEvent.deleteMany({
      aggregateId: { $in: [course._id, ...lessonIds] },
      status: { $in: ['PENDING', 'PROCESSING'] },
    }),
  ]);

  // Close every live stream for this course — its own and any lesson's — with a
  // single publish on the fan-out channel they all subscribe to. Published after the
  // cascade so a client that reacts by re-fetching gets a clean 404 rather than
  // racing the deletes. Best-effort by design: publishing swallows its own errors.
  await publishCourseDeleted(course._id);

  return res.status(200).json({
    success: true,
    data: { courseId: String(course._id), deleted: true },
  });
};

