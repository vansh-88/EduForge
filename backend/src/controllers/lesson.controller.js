import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { requestLessonGeneration } from '../services/lesson/lesson.service.js';

function getAuthenticatedUserId(req) {
  return req.auth?.payload?.sub || req.user?.sub || req.user?.id || null;
}

function hashRequest(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export const generateLesson = async (req, res, next) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { courseId, lessonId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(lessonId)) {
      return res.status(400).json({ success: false, error: 'Invalid course or lesson ID' });
    }

    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
    }

    // Hash the route params instead of a request body since there is no body
    const requestHash = hashRequest({ courseId, lessonId });

    // Delegate to the pure service
    const result = await requestLessonGeneration({
      userId, 
      courseId, 
      lessonId, 
      idempotencyKey, 
      requestHash,
    });

    // Add a header so clients know if they hit the cache
    if (result.isCached) {
      res.set('X-Idempotency-Replayed', 'true');
    }

    return res.status(result.statusCode).json(result.data);

  } catch (error) {
    if (error.message === 'IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({ success: false, error: error.message });
    }
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'Lesson not found' });
    }
    
    // Pass to global error handler
    next(error);
  }
};