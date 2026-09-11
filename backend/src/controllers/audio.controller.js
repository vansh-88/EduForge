import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { requestLessonAudio, getLessonAudio } from '../services/audio/audio.service.js';

function hashRequest(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function invalidIds({ courseId, moduleId, lessonId }) {
  return (
    !mongoose.Types.ObjectId.isValid(courseId) ||
    !mongoose.Types.ObjectId.isValid(moduleId) ||
    !mongoose.Types.ObjectId.isValid(lessonId)
  );
}

export const requestAudio = async (req, res) => {
  const userId = req.user._id;
  const { courseId, moduleId, lessonId } = req.params;

  if (invalidIds(req.params)) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
  }

  // Hash the route params: voice and language are server-configured in V1, so
  // there is no body that could vary the request.
  const requestHash = hashRequest({ courseId, moduleId, lessonId });

  const result = await requestLessonAudio({
    userId,
    courseId,
    moduleId,
    lessonId,
    idempotencyKey,
    requestHash,
  });

  if (result.isCached) {
    res.set('X-Idempotency-Replayed', 'true');
  }

  return res.status(result.statusCode).json(result.data);
};

/**
 * Read a lesson's audio and all of its segments.
 *
 * Side-effect free — unlike the POST it can never start a job, so a player may
 * re-read it freely (on reconnect, or to recover a missed SSE event).
 */
export const getAudio = async (req, res) => {
  const userId = req.user._id;
  const { courseId, moduleId, lessonId } = req.params;

  if (invalidIds(req.params)) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  const data = await getLessonAudio({ userId, courseId, moduleId, lessonId });

  return res.status(200).json({ success: true, data });
};
