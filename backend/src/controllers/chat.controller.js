import {
  createSession, listSessions, getSession, deleteSession, sendMessage, streamMessage,
} from '../services/chat/chat.service.js';
import {
  toChatSessionDTO, toChatSessionDetailDTO, toChatMessageDTO,
} from '../serializers/chat.serializer.js';
import { openChatStream } from '../services/realtime/chatStream.js';

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


/**
 * Asks a question and streams the answer as it is generated.
 *
 * The browser's endpoint. POST rather than GET because the question travels in the
 * body, which is also why the client cannot use the native EventSource — it only
 * issues GETs and cannot set an Authorization header. The frontend already uses a
 * fetch-based SSE client for exactly that reason.
 *
 * Everything that can refuse this request must refuse it BEFORE the stream opens:
 * once the 200 and the SSE headers are committed there is no status code left to
 * send, and an error can only be reported as an event. So authorization happens
 * inside streamMessage's prepareTurn, and anything it throws propagates to the normal
 * error handler with the headers still unsent.
 *
 * Errors AFTER that point are carried as a `message_failed` event instead. The global
 * handler's res.headersSent branch is the backstop if one escapes.
 */
export const streamChatMessage = async (req, res) => {
  const stream = openChatStream(req, res);

  try {
    await streamMessage({
      userId: req.user._id,
      courseId: req.params.courseId,
      sessionId: req.params.sessionId,
      message: req.validated.body.message,
      clientMessageId: req.validated.body.clientMessageId ?? null,
      stream,
    });
  } catch (error) {
    // prepareTurn throws before a byte is written for anything a client can fix — a
    // session that is not theirs, a course that does not exist. The stream is already
    // open by then, so it cannot become a 404; report it as a terminal event with the
    // code the client already knows how to render.
    if (!stream.closed) {
      stream.send('message_failed', {
        error: error.message,
        code: error.code ?? (error.statusCode === 404 ? 'NOT_FOUND' : 'CHAT_ERROR'),
      });
      stream.close();
    }
  }
};
