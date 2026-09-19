import {
  createSession, listSessions, getSession, deleteSession, sendMessage,
} from '../services/chat/chat.service.js';
import {
  toChatSessionDTO, toChatSessionDetailDTO, toChatMessageDTO,
} from '../serializers/chat.serializer.js';

/**
 * Thin by design.
 *
 * Authorization, retrieval, prompt construction and persistence all live in the chat
 * service. What is left here is reading the request and shaping the response — which
 * is what keeps there from being a second place where "may this user see this course"
 * is decided, and therefore a second place it can be decided wrongly.
 *
 * No try/catch: Express 5 forwards a rejected promise to the error handler on its
 * own, and ApiError already carries the status and code the client reads.
 */

export const createChatSession = async (req, res) => {
  const session = await createSession({
    userId: req.user._id,
    courseId: req.params.courseId,
    lessonId: req.validated?.body?.lessonId ?? null,
  });

  return res.status(201).json({ success: true, data: toChatSessionDTO(session) });
};

export const listChatSessions = async (req, res) => {
  const sessions = await listSessions({
    userId: req.user._id,
    courseId: req.params.courseId,
  });

  return res.status(200).json({ success: true, data: sessions.map(toChatSessionDTO) });
};

export const getChatSession = async (req, res) => {
  const { session, messages } = await getSession({
    userId: req.user._id,
    courseId: req.params.courseId,
    sessionId: req.params.sessionId,
  });

  return res.status(200).json({ success: true, data: toChatSessionDetailDTO(session, messages) });
};

export const deleteChatSession = async (req, res) => {
  const result = await deleteSession({
    userId: req.user._id,
    courseId: req.params.courseId,
    sessionId: req.params.sessionId,
  });

  return res.status(200).json({ success: true, data: result });
};

/**
 * Asks a question and returns the whole answer.
 *
 * Phase 6 adds a streaming sibling at .../messages/stream. This endpoint stays: it is
 * what a non-browser caller wants, and what makes the pipeline testable with curl.
 *
 * `retrievalDegraded` is surfaced rather than swallowed. It means the answer was
 * produced without the course index — an index still building, or a question that
 * could not be embedded — which is the difference between "your course does not
 * cover this" and "we could not look".
 */
export const postChatMessage = async (req, res) => {
  const result = await sendMessage({
    userId: req.user._id,
    courseId: req.params.courseId,
    sessionId: req.params.sessionId,
    message: req.validated.body.message,
    clientMessageId: req.validated.body.clientMessageId ?? null,
  });

  // 200 rather than 201 on a replayed retry: nothing new was created, and the client
  // gets back exactly what its first attempt produced.
  return res.status(result.replay ? 200 : 201).json({
    success: true,
    data: {
      userMessage: toChatMessageDTO(result.userMessage),
      answer: result.answer ? toChatMessageDTO(result.answer) : null,
      replay: result.replay,
      ...(result.retrievalDegraded ? { retrievalDegraded: true } : {}),
    },
  });
};
