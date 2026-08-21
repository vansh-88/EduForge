import crypto from 'node:crypto';
import { generateCourseRequestSchema } from '../schemas/index.js';
import { newCourseGeneration } from '../services/course/course.service.js';
import { Course, Module } from '../models/index.js';
import mongoose from 'mongoose';

function getAuthenticatedUserId(req) {
  return req.auth?.payload?.sub || req.user?.sub || req.user?.id || null;
}


function hashRequest(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}


export const generateCourse = async (req, res, next) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
    }

    //topic already validated by the middleware.
    const { topic } = req.body;
    const requestHash = hashRequest(req.body);

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

  } catch (error) {
    if (error.message === 'IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({ success: false, error: error.message });
    }
    
    // Pass to global error handler
    next(error);
  }
};


export const listCourses = async (req, res, next) => {

  try {

    const userId = getAuthenticatedUserId(req);

    if (!userId) { 
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized: User not found' 
      }); 
    }

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

  } catch (error) {
    next(error);
  }
};


export const getCourseById = async (req, res, next) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User not found',
      });
    }

    const { courseId } = req.params;

    // Validate MongoDB ObjectId before querying
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid course ID',
      });
    }

    const course = await Course.findOne({
      _id: courseId,
      creator: userId,
    })
      .populate({
        path: 'modules',
        select: 'title goal order',
      })
      .lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
      });
    }

    // Ensure modules are always returned in their intended order.
    if (Array.isArray(course.modules)) {
      course.modules.sort((a, b) => a.order - b.order);
    }

    return res.status(200).json({
      success: true,
      data: {
        course,
      },
    });
  } catch (error) {
    next(error);
  }
};


export const getModuleById = async (req, res, next) => {
  try {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User not found',
      });
    }

    const { courseId, moduleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid course or module ID',
      });
    }

    const module = await Module.findOne({
      _id: moduleId,
      course: courseId,
    })
      .populate({ path: 'course', select: 'creator' })
      .populate({ path: 'lessons', select: 'title order status objectives' })
      .lean();

    if (!module || module.course.creator !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Module not found',
      });
    }

    // Ensure lessons are always returned in their intended order.
    if (Array.isArray(module.lessons)) {
      module.lessons.sort((a, b) => a.order - b.order);
    }

    // course was only needed for the ownership check above — don't leak it in the response.
    delete module.course;

    return res.status(200).json({
      success: true,
      data: {
        module,
      },
    });
  } catch (error) {
    next(error);
  }
};


export const retryCourseGeneration = async (req, res, next) => {

};






