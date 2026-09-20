import crypto from 'node:crypto';
import { generateCourseRequestSchema } from '../schemas/index.js';
import { newCourseGeneration, retryCourseGeneration as retryCourseGenerationService } from '../services/course/course.service.js';
import { Course, CourseProgress } from '../models/index.js';
import { collectCourseCascadeIds, purgeCourseChildren } from '../services/course/cascade.js';
import mongoose from 'mongoose';
import { computeProgress, getOrCreateProgress } from '../services/progress/progress.service.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { publishCourseDeleted } from '../services/realtime/generationEvents.js';
import { destroyLessonAudio } from '../services/media/audio.service.js';
import { toCourseCardDTO, toCourseDetailDTO } from '../serializers/course.serializer.js';


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
    ...toCourseCardDTO(course),
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

  // computeProgress returns a *count* of completed lessons, which is all the
  // list and dashboard views need. The overview renders the curriculum itself,
  // so it needs to know which specific lessons are done — and this handler
  // already holds the progress document, making it free here and a per-lesson
  // lookup anywhere else.
  const completedLessonIds = (progress.completedLessons ?? []).map(String);

  return res.status(200).json({
    success: true,
    data: { course: toCourseDetailDTO(course), progress: progressSummary, completedLessonIds },
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

  /*
   * One transaction, children first, the course itself last.
   *
   * This used to delete the course up front and then fan the child deletes out
   * through Promise.all, unguarded. That has no answer to being interrupted — a
   * redeploy, a free-tier spin-down, a dropped connection to Atlas — and an
   * interruption is not hypothetical: it has already happened here, leaving a
   * database with modules gone, some of their lessons still present, and video
   * slots pointing at a course that no longer exists. Once the Course document is
   * removed nothing can find that wreckage again, because the course id is the
   * only handle on it.
   *
   * So: everything commits together or nothing does, and the ordering is chosen so
   * that even a torn-down transaction fails safe. The worst case is now a course
   * that is still there, which the user can simply delete again.
   */
  const session = await mongoose.startSession();
  let course = null;

  try {
    await session.withTransaction(async () => {
      // Re-read inside the transaction on every attempt — withTransaction retries
      // the whole callback on a transient error, and this must not carry a document
      // read during an attempt that was rolled back.
      course = await Course.findOne({ _id: courseId, creator: userId }).session(session);

      if (!course) return;

      const ids = await collectCourseCascadeIds([course._id], { session });
      await purgeCourseChildren([course._id], ids, { session });

      // Last, and still filtered by creator: ownership is enforced at the moment of
      // removal, not merely at the read above, so the check-then-act window the
      // original findOneAndDelete avoided stays closed.
      await Course.deleteOne({ _id: course._id, creator: userId }, { session });

      // Carried out of the transaction for the Cloudinary purge below.
      course = { _id: course._id, lessonIds: ids.lessonIds };
    });
  } finally {
    await session.endSession();
  }

  if (!course) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  // The audio bytes live in Cloudinary, so deleting the rows was only half the
  // cascade. Outside the transaction and after it commits, because it is an external
  // side effect that cannot be rolled back: an orphaned object costs storage, but a
  // failed purge must not fail a delete MongoDB has already committed.
  await Promise.all(course.lessonIds.map((id) => destroyLessonAudio(id)));

  // Close every live stream for this course — its own and any lesson's — with a
  // single publish on the fan-out channel they all subscribe to. Published after the
  // commit so a client that reacts by re-fetching gets a clean 404 rather than
  // racing the deletes. Best-effort by design: publishing swallows its own errors.
  await publishCourseDeleted(course._id);

  return res.status(200).json({
    success: true,
    data: { courseId: String(course._id), deleted: true },
  });
};

