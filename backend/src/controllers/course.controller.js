import crypto from 'node:crypto';
import { generateCourseRequestSchema } from '../schemas/index.js';
import { newCourseGeneration } from '../services/course/course.service.js';


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