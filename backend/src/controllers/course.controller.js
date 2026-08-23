import crypto from 'node:crypto';
import { generateCourseRequestSchema } from '../schemas/index.js';
import { newCourseGeneration, retryCourseGeneration as retryCourseGenerationService } from '../services/course/course.service.js';
import { Course } from '../models/index.js';
import mongoose from 'mongoose';
import { computeProgress, getOrCreateProgress } from '../services/progress/progress.service.js';


function hashRequest(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}


export const generateCourse = async (req, res) => {
  const userId = req.user._id;

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
  }

  //topic already validated by the middleware.
  const { topic } = req.validated.body;
  const requestHash = hashRequest(req.validated.body);

  // Delegate to the pure service
  const result = await newCourseGeneration({
    userId,
    topic,
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

  let { page = '1', limit = '10', query, title, status, tags } = req.query;

  page = Number(page);
  limit = Number(limit);

  if (!Number.isInteger(page) || !Number.isInteger(limit) || page < 1 || limit < 1 || limit > 100) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid pagination parameters' 
    });
  }

  const filter = { creator: userId };

  // Search by generated course query
  if (typeof query === 'string' && query.trim()) {
    filter.query = {
      $regex: query.trim(),
      $options: 'i',
    };
  }

  // Search by course title
  if (typeof title === 'string' && title.trim()) {
    filter.title = {
      $regex: title.trim(),
      $options: 'i',
    };
  }

  // Filter by status
  if (typeof status === 'string' && status.trim()) {
    filter.status = status.trim();
  }

  if (tags) {
    const tagList = Array.isArray(tags)
      ? tags
      : String(tags)
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);

    if (tagList.length > 0) {
      filter.tags = {
        $in: tagList,
      };
    }
  }

  const skip = (page - 1) * limit;

  const [courses, total] = await Promise.all([
    Course.find(filter)
      .select('query title status tags createdAt')
      .sort({ createdAt: -1, _id: -1})
      .skip(skip)
      .limit(limit)
      .lean(),

    Course.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);

  return res.status(200).json({
    success: true,
    data: {
      courses,
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






