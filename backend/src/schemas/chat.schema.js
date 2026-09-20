import { z } from 'zod';
import mongoose from 'mongoose';
import { CHAT_MESSAGE_MAX_CHARS } from '../config/env.config.js';

const objectId = (field) =>
  z.string().trim().refine((value) => mongoose.Types.ObjectId.isValid(value), {
    message: `${field} must be a valid MongoDB ObjectId`,
  });

/**
 * Starting a conversation.
 *
 * `lessonId` is nullable rather than required: a null lesson is a course-level
 * conversation, not a missing value. Both are first-class — the difference is only
 * what enters the prompt verbatim, never what retrieval is allowed to reach.
 */
export const createChatSessionSchema = z.object({
  lessonId: objectId('lessonId').nullish(),
});

/**
 * Asking a question.
 *
 * The length cap is a guard rail, not a UX limit: it sits well above any real
 * question, and low enough that the message body cannot be used to push the system
 * instruction out of the model's attention with a wall of text.
 */
export const sendChatMessageSchema = z.object({
  message: z
    .string({ required_error: 'message is required' })
    .trim()
    .min(1, 'message cannot be empty')
    .max(CHAT_MESSAGE_MAX_CHARS, `message cannot exceed ${CHAT_MESSAGE_MAX_CHARS} characters`),

  /**
   * Client-generated, and what makes a retry safe.
   *
   * The browser may resend a message it never saw acknowledged — a dropped
   * connection mid-answer looks exactly like a request that never arrived. Without
   * this the student's question is asked twice, answered twice, and billed twice.
   * Optional so a caller that cannot generate one still works; the unique index on
   * (session, clientMessageId) is sparse for the same reason.
   */
  clientMessageId: z.string().trim().min(1).max(100).optional(),
});
