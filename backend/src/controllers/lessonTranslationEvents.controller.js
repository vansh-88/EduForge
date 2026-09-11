import mongoose from 'mongoose';
import { LessonTranslation } from '../models/index.js';
import { loadAuthorizedLesson } from '../services/lesson/lesson.service.js';
import { streamGeneration } from '../services/realtime/generationStream.js';
import { translationChannel, courseDeletedChannel } from '../services/realtime/generationEvents.js';
import { TRANSLATION_LANGUAGES } from '../schemas/index.js';

// A translation has no sibling resources reporting in after it, so unlike the
// lesson stream this one really does end at 'completed'.
//
// 'course_deleted' is terminal for the same reason it is everywhere else: the
// parent course is gone, cascading this translation away, so the stream must
// close rather than heartbeat against a missing document.
const TERMINAL_EVENT_TYPES = [
  'lesson_translation_completed',
  'lesson_translation_failed',
  'course_deleted',
];

export const streamLessonTranslationEvents = async (req, res) => {
  const userId = req.user._id;
  const { courseId, moduleId, lessonId, language } = req.params;

  if (
    !mongoose.Types.ObjectId.isValid(courseId) ||
    !mongoose.Types.ObjectId.isValid(moduleId) ||
    !mongoose.Types.ObjectId.isValid(lessonId)
  ) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  if (!TRANSLATION_LANGUAGES.includes(language)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported language. Supported: ${TRANSLATION_LANGUAGES.join(', ')}`,
    });
  }

  // Authorize BEFORE streamGeneration commits headers — a 4xx is impossible once
  // the response has started. Throws ApiError.notFound (404) on a mismatch.
  await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });

  return streamGeneration(req, res, {
    kind: 'lesson_translation',
    id: lessonId,
    // Also watches the parent course's fan-out, so deleting the course closes
    // this stream without needing a publish per translation.
    channels: [translationChannel(lessonId, language), courseDeletedChannel(courseId)],

    // A row that does not exist yet is NOT nothing: the client opens this stream
    // immediately after POSTing, and the outbox publisher may not have dispatched
    // the job yet. Returning null would close the stream before the work started,
    // so report a PENDING placeholder and let the live events take over.
    loadSnapshot: async () => {
      const translation = await LessonTranslation.findOne({ lesson: lessonId, language })
        .select('status stage progress attempts maxAttempts lastError')
        .lean();

      return translation ?? { status: 'PENDING', stage: 'queued', progress: 0, attempts: 0, maxAttempts: null, lastError: null };
    },

    isTerminal: (snapshot) => snapshot.status === 'READY' || snapshot.status === 'FAILED',

    terminalTypes: TERMINAL_EVENT_TYPES,
  });
};
