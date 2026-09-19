/**
 * Wire shapes for the Course Tutor.
 *
 * Two things never cross this boundary. Embeddings, because a 768-float array per
 * chunk would dwarf the answer it accompanies and means nothing to a client. And
 * raw chunk content, because a citation is a pointer back into the course the
 * student already has — shipping the passage again would both bloat the response
 * and let the tutor's transcript become a second, stale copy of the lesson.
 */

export const toChatSessionDTO = (session) => ({
  id: session._id.toString(),
  courseId: session.course.toString(),
  lessonId: session.lesson ? session.lesson.toString() : null,
  title: session.title ?? null,
  messageCount: session.messageCount ?? 0,
  lastMessageAt: session.lastMessageAt ?? null,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

/**
 * One cited passage.
 *
 * Carries the ids a link back into the course needs — course, module and lesson are
 * all three required by the reader's route — plus the heading, so a citation can
 * name the section rather than only the lesson.
 *
 * `lessonTitle` may be null for a lesson deleted since the answer was given. The
 * client should render those as plain text rather than a dead link.
 */
export const toMessageSourceDTO = (source) => ({
  chunkId: source.chunk?.toString() ?? null,
  lessonId: source.lesson?.toString() ?? null,
  lessonTitle: source.lessonTitle ?? null,
  moduleId: source.moduleId ? source.moduleId.toString() : null,
  heading: source.heading ?? null,
  score: typeof source.score === 'number' ? Number(source.score.toFixed(4)) : null,
});

export const toChatMessageDTO = (message) => ({
  id: message._id.toString(),
  role: message.role,
  content: message.content,
  // Only meaningful on assistant messages, and only ever true when a stream was cut
  // short. The client uses it to mark the answer as incomplete rather than letting a
  // half explanation read as a finished one.
  truncated: Boolean(message.truncated),
  sources: (message.sources ?? []).map(toMessageSourceDTO),
  createdAt: message.createdAt,
});

/** A session together with its conversation. */
export const toChatSessionDetailDTO = (session, messages) => ({
  ...toChatSessionDTO(session),
  messages: messages.map(toChatMessageDTO),
});
