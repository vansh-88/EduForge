import crypto from 'node:crypto';
import { generateCourseRequestSchema } from '../schemas/index.js';
import { newCourseGeneration } from '../services/course/course.service.js';
import { Course } from '../../models/index.js';


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

    let { page = '1', limit = '10', query, title, status, tag } = req.query;

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





