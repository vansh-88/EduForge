import mongoose from 'mongoose';
import { Lesson } from '../models/index.js';
import { loadAuthorizedLesson } from '../services/lesson/lesson.service.js';
import { streamGeneration } from '../services/realtime/generationStream.js';
import { channelFor, courseDeletedChannel } from '../services/realtime/generationEvents.js';

// 'course_deleted' is terminal too — the parent course was removed, cascading this
// lesson away, so the stream must close rather than heartbeat against a missing doc.
const TERMINAL_EVENT_TYPES = [
  'lesson_generation_completed',
  'lesson_generation_failed',
  'course_deleted',
];
const TERMINAL_STATUSES = ['READY', 'FAILED'];

export const streamLessonGenerationEvents = async (req, res) => {
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
  await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });

  return streamGeneration(req, res, {
    kind: 'lesson',
    id: lessonId,
    // Also watches the parent course's fan-out, so deleting the course closes this
    // stream without needing a publish per lesson.
    channels: [channelFor('lesson', lessonId), courseDeletedChannel(courseId)],
    loadSnapshot: () =>
      Lesson.findById(lessonId).select('status stage progress attempts maxAttempts lastError').lean(),
    isTerminal: (status) => TERMINAL_STATUSES.includes(status),
    terminalTypes: TERMINAL_EVENT_TYPES,
  });
};
