import mongoose from 'mongoose';
import { Lesson } from '../models/index.js';
import { subscribeLessonEvents } from '../services/realtime/lessonEvents.subscriber.js';
import { toGenerationEvent } from '../services/realtime/lessonEvents.publisher.js';
import { loadAuthorizedLesson } from '../services/lesson/lesson.service.js';

const TERMINAL_EVENT_TYPES = ['lesson_generation_completed', 'lesson_generation_failed'];
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

  let heartbeat = null;
  let snapshotSent = false;
  let closed = false;
  let buffered = [];

  const sendEvent = (event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Safe to call repeatedly: a terminal event and the client disconnect both fire it.
  const cleanup = () => {
    if (closed) return;
    closed = true;

    if (heartbeat) clearInterval(heartbeat);
    Promise.resolve(subscription?.close()).catch(() => {});
    res.end();
  };

  const emit = (event) => {
    if (closed) return;

    sendEvent(event);
    if (TERMINAL_EVENT_TYPES.includes(event.type)) cleanup();
  };

  // 1. Subscribe FIRST so nothing published between here and the snapshot read is
  // lost. Live events are buffered until the snapshot has gone out, otherwise they
  // would overtake it — or worse, a terminal event would end the stream before the
  // snapshot could be written.
  const subscription = subscribeLessonEvents(lessonId, (event) => {
    if (!snapshotSent) {
      buffered.push(event);
      return;
    }
    emit(event);
  });

  await subscription.subscribed;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
  });

  req.on('close', cleanup);

  // 2. Now read the MongoDB snapshot — the authoritative current state.
  const snapshot = await Lesson.findById(lessonId)
    .select('status stage progress attempts maxAttempts lastError')
    .lean();

  if (!snapshot) return cleanup();

  sendEvent(
    toGenerationEvent({
      type: 'lesson_generation_snapshot',
      status: snapshot.status,
      stage: snapshot.stage,
      progress: snapshot.progress,
      attempt: snapshot.attempts,
      maxAttempts: snapshot.maxAttempts,
      lastError: snapshot.lastError,
    })
  );

  snapshotSent = true;

  // Already terminal — nothing further will ever be published for this lesson.
  if (TERMINAL_STATUSES.includes(snapshot.status)) return cleanup();

  // 3. Flush anything that arrived while the snapshot was being read.
  const pending = buffered;
  buffered = [];
  for (const event of pending) emit(event);

  if (closed) return;

  heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
};
