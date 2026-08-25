import mongoose from 'mongoose';
import { Course } from '../models/index.js';
import { streamGeneration } from '../services/realtime/generationStream.js';
import { channelFor, courseDeletedChannel } from '../services/realtime/generationEvents.js';

// 'course_deleted' is terminal too: the course is gone, so nothing further is coming
// and the stream must release its Redis subscriber instead of heartbeating forever.
const TERMINAL_EVENT_TYPES = [
  'course_generation_completed',
  'course_generation_failed',
  'course_deleted',
];
const TERMINAL_STATUSES = ['READY', 'FAILED'];

export const streamCourseGenerationEvents = async (req, res) => {
  const userId = req.user._id;
  const { courseId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid course ID' });
  }

  // Ownership must be proven before headers are committed — after that a 4xx is no
  // longer possible.
  const owned = await Course.exists({ _id: courseId, creator: userId });

  if (!owned) {
    return res.status(404).json({ success: false, error: 'Course not found' });
  }

  return streamGeneration(req, res, {
    kind: 'course',
    id: courseId,
    channels: [channelFor('course', courseId), courseDeletedChannel(courseId)],
    loadSnapshot: () =>
      Course.findById(courseId).select('status stage progress attempts maxAttempts lastError').lean(),
    isTerminal: (status) => TERMINAL_STATUSES.includes(status),
    terminalTypes: TERMINAL_EVENT_TYPES,
  });
};
