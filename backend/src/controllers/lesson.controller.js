import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { requestLessonGeneration, loadAuthorizedLesson, ensureNextLessonGenerated } from '../services/lesson/lesson.service.js';
import { Lesson, Module } from '../models/index.js';
import { toLessonDTO } from '../serializers/lesson.serializer.js';
import { getOrCreateProgress, touchLastVisited } from '../services/progress/progress.service.js';


function hashRequest(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}


export const generateLesson = async (req, res) => {
  const userId = req.user._id;

  const { courseId, moduleId, lessonId } = req.params;

  if (
    !mongoose.Types.ObjectId.isValid(courseId) ||
    !mongoose.Types.ObjectId.isValid(moduleId) ||
    !mongoose.Types.ObjectId.isValid(lessonId)
  ) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ success: false, error: 'Idempotency-Key header is required' });
  }

  // Hash the route params instead of a request body since there is no body
  const requestHash = hashRequest({ courseId, moduleId, lessonId });

  // Delegate to the pure service
  const result = await requestLessonGeneration({
    userId,
    courseId,
    moduleId,
    lessonId,
    idempotencyKey,
    requestHash,
  });

  // Add a header so clients know if they hit the cache
  if (result.isCached) {
    res.set('X-Idempotency-Replayed', 'true');
  }

  return res.status(result.statusCode).json(result.data);

};


async function findAdjacentLesson(lesson, module, course, direction) {
  const cmp = direction === 1 ? '$gt' : '$lt';
  const sortOrder = direction === 1 ? 1 : -1;

  const adjacent = await Lesson.findOne({ module: module._id, order: { [cmp]: lesson.order } })
    .sort({ order: sortOrder })
    .select('_id');

  if (adjacent) return { moduleId: module._id, lessonId: adjacent._id };

  const adjacentModule = await Module.findOne({ course: course._id, order: { [cmp]: module.order } })
    .sort({ order: sortOrder });

  if (!adjacentModule) return null;

  const boundaryLesson = await Lesson.findOne({ module: adjacentModule._id })
    .sort({ order: sortOrder })
    .select('_id');

  if (!boundaryLesson) return null;

  return { moduleId: adjacentModule._id, lessonId: boundaryLesson._id };
}


export const getLesson = async (req, res) => {
  const userId = req.user._id;
  const { courseId, moduleId, lessonId } = req.params;

  if (
    !mongoose.Types.ObjectId.isValid(courseId) ||
    !mongoose.Types.ObjectId.isValid(moduleId) ||
    !mongoose.Types.ObjectId.isValid(lessonId)
  ) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  // Throws ApiError.notFound (404) if the lesson is missing or not the caller's.
  const lesson = await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });

  const { module } = lesson;
  const { course } = module;

  const [previous, next, progress] = await Promise.all([
    findAdjacentLesson(lesson, module, course, -1),
    findAdjacentLesson(lesson, module, course, 1),
    getOrCreateProgress(userId, courseId),
  ]);

  // Read-position tracking must never fail the request it rides along with.
  touchLastVisited({ userId, courseId, lessonId }).catch(() => {});

  // The user moved forward, so pull the lookahead window forward too. This never
  // generates the lesson being requested — only the one after it — so the "GET never
  // generates" rule still holds for the requested resource. Fire-and-forget: a
  // pre-generation failure must not fail the read.
  if (lesson.status === 'READY') {
    ensureNextLessonGenerated(lesson._id).catch((err) => {
      console.error(`[Lookahead] failed for lesson ${lessonId}:`, err.message);
    });
  }

  const completed = progress.completedLessons.some((id) => id.equals(lesson._id));

  return res.status(200).json({
    success: true,
    data: {
      lesson: toLessonDTO(lesson, { completed }),
      navigation: { previous, next },
    },
  });
};
