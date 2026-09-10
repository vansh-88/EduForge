import mongoose from 'mongoose';
import { Lesson, VideoSlot } from '../models/index.js';
import { loadAuthorizedLesson } from '../services/lesson/lesson.service.js';
import { streamGeneration } from '../services/realtime/generationStream.js';
import { channelFor, courseDeletedChannel } from '../services/realtime/generationEvents.js';

// Note what is NOT here: 'lesson_generation_completed'. Content becoming readable
// is no longer the end of the stream, because video slots resolve afterwards and
// publish onto this same channel. Closing at 'completed' would drop every one of
// those updates. 'lesson_enrichment_completed' — published once the last slot
// settles — is what ends the stream now.
//
// 'course_deleted' is terminal too: the parent course was removed, cascading this
// lesson away, so the stream must close rather than heartbeat against a missing doc.
const TERMINAL_EVENT_TYPES = [
  'lesson_enrichment_completed',
  'lesson_generation_failed',
  'course_deleted',
];

// Slot states that still have something to say.
const UNSETTLED_SLOT_STATUSES = ['PENDING', 'RESOLVING'];

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
    // The snapshot carries the lesson's own lifecycle plus how many video slots
    // are still outstanding, because both decide whether anything more is coming.
    // A client reconnecting mid-enrichment needs the stream to stay open.
    loadSnapshot: async () => {
      const lesson = await Lesson.findById(lessonId)
        .select('status stage progress attempts maxAttempts lastError')
        .lean();

      if (!lesson) return null;

      const unsettledSlots = await VideoSlot.countDocuments({
        lesson: lessonId,
        status: { $in: UNSETTLED_SLOT_STATUSES },
      });

      return { ...lesson, unsettledSlots };
    },

    // FAILED is the end regardless — there is no content to enrich. READY only
    // ends the stream once every slot has settled.
    isTerminal: (snapshot) =>
      snapshot.status === 'FAILED' ||
      (snapshot.status === 'READY' && snapshot.unsettledSlots === 0),

    terminalTypes: TERMINAL_EVENT_TYPES,
  });
};
