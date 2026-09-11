import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { requestLessonTranslation, getLessonTranslation } from '../services/translation/translation.service.js';
import { TRANSLATION_LANGUAGES } from '../schemas/index.js';

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

export const requestTranslation = async (req, res) => {
  const userId = req.user._id;
  const { courseId, moduleId, lessonId } = req.params;

  if (invalidIds(req.params)) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
  }

  // Already validated and defaulted by the schema middleware.
  const { language } = req.validated.body;

  // The language is part of the identity of the request, so two languages under
  // one key is a genuine conflict rather than a replay.
  const requestHash = hashRequest({ courseId, moduleId, lessonId, language });

  const result = await requestLessonTranslation({
    userId,
    courseId,
    moduleId,
    lessonId,
    language,
    idempotencyKey,
    requestHash,
  });

  if (result.isCached) {
    res.set('X-Idempotency-Replayed', 'true');
  }

  return res.status(result.statusCode).json(result.data);
};

/**
 * Read one translation. Deliberately has no side effects — unlike POST it can
 * never start a job, so a client may poll or re-read it freely.
 */
export const getTranslation = async (req, res) => {
  const userId = req.user._id;
  const { courseId, moduleId, lessonId, language } = req.params;

  if (invalidIds(req.params)) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  if (!TRANSLATION_LANGUAGES.includes(language)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported language. Supported: ${TRANSLATION_LANGUAGES.join(', ')}`,
    });
  }

  const data = await getLessonTranslation({ userId, courseId, moduleId, lessonId, language });

  return res.status(200).json({ success: true, data });
};
