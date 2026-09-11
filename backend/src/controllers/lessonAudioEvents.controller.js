import mongoose from 'mongoose';
import { LessonAudio } from '../models/index.js';
import { loadAuthorizedLesson } from '../services/lesson/lesson.service.js';
import { streamGeneration } from '../services/realtime/generationStream.js';
import { audioChannel, courseDeletedChannel } from '../services/realtime/generationEvents.js';
import { TTS_LANGUAGE, TTS_VOICE } from '../config/env.config.js';

// Note what is NOT here: 'audio_segment_ready'. A segment becoming playable is
// the beginning of listening, not the end of generating — closing there would
// drop every remaining segment, which is the opposite of what progressive
// playback needs.
const TERMINAL_EVENT_TYPES = [
  'audio_completed',
  'audio_failed',
  'course_deleted',
];

export const streamLessonAudioEvents = async (req, res) => {
  const userId = req.user._id;
  const { courseId, moduleId, lessonId } = req.params;

  if (
    !mongoose.Types.ObjectId.isValid(courseId) ||
    !mongoose.Types.ObjectId.isValid(moduleId) ||
    !mongoose.Types.ObjectId.isValid(lessonId)
  ) {
    return res.status(400).json({ success: false, error: 'Invalid course, module, or lesson ID' });
  }

  // Authorize BEFORE streamGeneration commits headers — a 4xx is impossible once
  // the response has started. Throws ApiError.notFound (404) on a mismatch.
  await loadAuthorizedLesson({ userId, courseId, moduleId, lessonId });

  return streamGeneration(req, res, {
    kind: 'lesson_audio',
    id: lessonId,
    channels: [audioChannel(lessonId), courseDeletedChannel(courseId)],

    // A row that does not exist yet is NOT nothing: the client opens this stream
    // straight after POSTing and the outbox publisher may not have dispatched the
    // job. Returning null would close the stream before the work began, so report
    // a PENDING placeholder and let the live events take over.
    loadSnapshot: async () => {
      const audio = await LessonAudio.findOne({ lesson: lessonId, language: TTS_LANGUAGE, voice: TTS_VOICE })
        .select('status stage progress attempts maxAttempts lastError')
        .lean();

      return audio ?? { status: 'PENDING', stage: 'queued', progress: 0, attempts: 0, maxAttempts: null, lastError: null };
    },

    isTerminal: (snapshot) => snapshot.status === 'READY' || snapshot.status === 'FAILED',

    terminalTypes: TERMINAL_EVENT_TYPES,
  });
};
