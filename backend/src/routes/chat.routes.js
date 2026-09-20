import { Router } from 'express';
import {
  createChatSession, listChatSessions, getChatSession, deleteChatSession, postChatMessage, streamChatMessage,
} from '../controllers/chat.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createChatSessionSchema, sendChatMessageSchema } from '../schemas/index.js';
import { writeRateLimiter, chatRateLimiter } from '../middlewares/rateLimit.middleware.js';

/**
 * Mounted under /v1/courses/:courseId/chat.
 *
 * Nested under the course rather than given a top-level /v1/chat mount, for two
 * reasons. It inherits requireAuth/attachUser/readRateLimiter from the parent, so
 * there is no second authentication path to keep in step. And the courseId is in
 * the route, which means every request states the course it is scoped to and the
 * service can verify the session belongs to it — rather than taking the retrieval
 * scope from whatever the session happens to say.
 *
 * mergeParams so :courseId is visible here.
 */
export const chatRouter = Router({ mergeParams: true });

// Created on the first question rather than when the panel opens, so browsing a
// course does not litter it with empty sessions.
chatRouter.post('/sessions', writeRateLimiter, validate(createChatSessionSchema), createChatSession);

chatRouter.get('/sessions', listChatSessions);
chatRouter.get('/sessions/:sessionId', getChatSession);

chatRouter.delete('/sessions/:sessionId', writeRateLimiter, deleteChatSession);

// Its own limiter tier: one provider call per message plus a small embedding call to
// retrieve with. Cheaper than generating a lesson, but a conversation is many
// messages where a lesson is a single request.
chatRouter.post(
  '/sessions/:sessionId/messages',
  chatRateLimiter,
  validate(sendChatMessageSchema),
  postChatMessage
);

/**
 * The streaming sibling, and what the browser actually calls.
 *
 * Same limiter tier as the non-streaming endpoint — it is the same provider call, so
 * the cost is identical and routing around the limit by choosing a transport would
 * make the tier meaningless.
 *
 * NOT on the stream tier that the generation SSE routes use. That tier exists because
 * each of those holds a dedicated Redis subscriber open for its lifetime; this holds
 * no Redis connection at all, and lives only as long as one answer takes to write.
 */
chatRouter.post(
  '/sessions/:sessionId/messages/stream',
  chatRateLimiter,
  validate(sendChatMessageSchema),
  streamChatMessage
);
