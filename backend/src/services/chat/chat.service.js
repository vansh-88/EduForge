import mongoose from 'mongoose';
import { Course, Lesson, ChatSession, ChatMessage } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { loadAuthorizedLesson } from '../lesson/lesson.service.js';
import { ensureCourseIndexed } from '../knowledge/indexing.service.js';
import { retrieveRelevantChunks } from './retrieval.service.js';
import { buildTutorContext } from './context.builder.js';
import { chat as generateChatAnswer, chatStream } from '../ai/aiService.js';
import { CHAT_MODEL } from '../../config/env.config.js';

/**
 * The Course Tutor's application layer.
 *
 * Everything that decides what a student is allowed to see lives here rather than in
 * the controller, and nothing below this layer re-checks it. Retrieval in particular
 * trusts its courseId completely — by design, since re-deriving authorization inside
 * a vector search is not something that can be done — so the course id it is handed
 * must already have been proven to belong to the caller. That proof happens in this
 * file and only in this file.
 */

/**
 * One line per tutor turn.
 *
 * Deliberately records ids and measurements and NOTHING ELSE. The question and the
 * answer are absent by design: chat content is the most sensitive data this feature
 * handles, it is already durably stored where it belongs, and a production log is
 * the one place it must not also accumulate.
 *
 * What IS here is what a slow or bad answer is diagnosed from — time to first token,
 * which is the metric streaming exists to improve; how much course context was
 * actually found; and whether retrieval was degraded, which is the difference
 * between "the course does not cover this" and "we could not look".
 */
function logTurn({ userId, courseId, sessionId, messageId, stats, retrieval, usage, ttftMs, startedAt, truncated, failed }) {
  const parts = [
    `user=${userId}`,
    `course=${courseId}`,
    `session=${sessionId}`,
    messageId ? `message=${messageId}` : null,
    `model=${CHAT_MODEL}`,
    `chunks=${stats?.retrievedChunks ?? 0}`,
    stats?.duplicateChunksDropped ? `dupesDropped=${stats.duplicateChunksDropped}` : null,
    retrieval?.degraded ? `degraded=${retrieval.reason}` : null,
    ttftMs != null ? `ttft=${ttftMs}ms` : null,
    `total=${Date.now() - startedAt}ms`,
    usage?.inputTokens != null ? `in=${usage.inputTokens}` : null,
    usage?.outputTokens != null ? `out=${usage.outputTokens}` : null,
    truncated ? 'truncated' : null,
  ].filter(Boolean);

  console.log(`[Tutor] ${failed ? '❌' : '💬'} ${parts.join(' ')}`);
}

/** Proves the caller owns the course, and returns it. */
async function loadAuthorizedCourse({ userId, courseId }) {
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    throw ApiError.notFound('Course not found', { code: 'NOT_FOUND' });
  }

  const course = await Course.findOne({ _id: courseId, creator: userId })
    .select('title difficulty')
    .lean();

  // 404 rather than 403 on a course owned by someone else, matching the rest of the
  // API: a 403 confirms the id exists, which is itself a disclosure.
  if (!course) throw ApiError.notFound('Course not found', { code: 'NOT_FOUND' });

  return course;
}

/**
 * Proves the caller owns the session AND that it belongs to the course in the path.
 *
 * Both halves matter. Ownership alone would let a session created under course A be
 * driven from a request addressed to course B — and since the retrieval scope is
 * taken from the route, that is precisely how a student would read a course they
 * merely happen to own a session for. Checking the pair closes it.
 */
async function loadAuthorizedSession({ userId, courseId, sessionId }) {
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw ApiError.notFound('Chat session not found', { code: 'NOT_FOUND' });
  }

  const session = await ChatSession.findOne({
    _id: sessionId,
    user: userId,
    course: courseId,
  });

  if (!session) throw ApiError.notFound('Chat session not found', { code: 'NOT_FOUND' });

  return session;
}

/**
 * Starts a conversation.
 *
 * Called on the student's FIRST question rather than when the tutor panel opens —
 * a reader paging through a course would otherwise leave an empty session behind on
 * every lesson they glanced at.
 *
 * Also the moment the course's knowledge index is checked. Courses generated before
 * this feature existed have no chunks and nothing would ever ask for them; this is
 * the trigger that backfills them. Deliberately not awaited for its result and
 * never allowed to fail the request: indexing is background work, the answer does
 * not depend on it, and the current lesson reaches the prompt verbatim regardless.
 */
export async function createSession({ userId, courseId, lessonId = null }) {
  const course = await loadAuthorizedCourse({ userId, courseId });

  // Validates the whole course → module → lesson hierarchy, so a lessonId belonging
  // to a DIFFERENT course cannot be attached to this session.
  if (lessonId) {
    await loadAuthorizedLesson({ userId, courseId: String(courseId), lessonId });
  }

  const session = await ChatSession.create({
    user: userId,
    course: course._id ?? courseId,
    lesson: lessonId ?? null,
  });

  ensureCourseIndexed(courseId).catch((error) => {
    console.warn(`[Chat] ⚠️ Backfill check failed for course=${courseId}: ${error.message}`);
  });

  return session;
}

export async function listSessions({ userId, courseId }) {
  await loadAuthorizedCourse({ userId, courseId });

  return ChatSession.find({ user: userId, course: courseId })
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
}

export async function getSession({ userId, courseId, sessionId }) {
  await loadAuthorizedCourse({ userId, courseId });
  const session = await loadAuthorizedSession({ userId, courseId, sessionId });

  const messages = await ChatMessage.find({ session: session._id })
    .sort({ createdAt: 1 })
    .lean();

  return { session, messages: await hydrateSources(messages) };
}

export async function deleteSession({ userId, courseId, sessionId }) {
  await loadAuthorizedCourse({ userId, courseId });
  const session = await loadAuthorizedSession({ userId, courseId, sessionId });

  // Messages first, then the session: the session is the only handle on them, so
  // removing it first would orphan the conversation — the same ordering rule the
  // course cascade follows, and for the same reason.
  await ChatMessage.deleteMany({ session: session._id });
  await ChatSession.deleteOne({ _id: session._id });

  return { sessionId: String(session._id), deleted: true };
}

/**
 * Fills in the lesson title and module id each citation needs to be a link.
 *
 * Read from the Lesson documents rather than stored on the message, because a lesson
 * can be renamed and a citation showing the title it had when the answer was given
 * points at something the student cannot find. One query for the whole conversation.
 */
async function hydrateSources(messages) {
  const lessonIds = [
    ...new Set(
      messages.flatMap((message) => (message.sources ?? []).map((source) => String(source.lesson)))
    ),
  ];

  if (lessonIds.length === 0) return messages;

  const lessons = await Lesson.find({ _id: { $in: lessonIds } }).select('title module').lean();
  const byId = new Map(lessons.map((lesson) => [String(lesson._id), lesson]));

  return messages.map((message) => ({
    ...message,
    sources: (message.sources ?? []).map((source) => {
      const lesson = byId.get(String(source.lesson));
      return {
        ...source,
        // Null for a lesson deleted since. The client renders those as plain text
        // rather than a dead link.
        lessonTitle: lesson?.title ?? null,
        moduleId: lesson?.module ?? null,
      };
    }),
  }));
}

/**
 * Everything a tutor turn needs, short of producing the answer.
 *
 * Split out from sendMessage because Phase 6 streams the same preparation into an
 * SSE response: the retrieval, the context and the persisted question are identical
 * whether the answer arrives in one piece or a token at a time. Only the provider
 * call differs.
 */
export async function prepareTurn({ userId, courseId, sessionId, message, clientMessageId = null }) {
  const course = await loadAuthorizedCourse({ userId, courseId });
  const session = await loadAuthorizedSession({ userId, courseId, sessionId });

  /*
   * Idempotency, before anything is spent.
   *
   * A browser may resend a question it never saw acknowledged — a connection dropped
   * mid-answer is indistinguishable from a request that never arrived. Returning the
   * existing turn makes the retry free rather than a second question, a second
   * provider call, and a duplicate in the transcript.
   */
  if (clientMessageId) {
    const existing = await ChatMessage.findOne({ session: session._id, clientMessageId }).lean();
    if (existing) {
      const answer = await ChatMessage.findOne({
        session: session._id,
        role: 'assistant',
        createdAt: { $gt: existing.createdAt },
      })
        .sort({ createdAt: 1 })
        .lean();

      return { replay: true, session, userMessage: existing, answer };
    }
  }

  // The lesson is loaded through the authorized path even though the session already
  // names it: a lesson can be deleted after a session is created, and re-proving the
  // hierarchy is cheaper than reasoning about whether it could have moved.
  let lesson = null;
  if (session.lesson) {
    try {
      lesson = await Lesson.findById(session.lesson).select('title content status module').lean();
    } catch {
      lesson = null;
    }
  }

  // Persisted BEFORE the provider call, so a question is never lost to a failure or
  // a disconnect that happens while it is being answered.
  const userMessage = await ChatMessage.create({
    session: session._id,
    course: session.course,
    role: 'user',
    content: message,
    // Omitted rather than nulled when absent — see the partial index on the model.
    ...(clientMessageId ? { clientMessageId } : {}),
  });

  const history = await ChatMessage.find({
    session: session._id,
    _id: { $ne: userMessage._id },
  })
    .sort({ createdAt: 1 })
    .select('role content')
    .lean();

  const retrieval = await retrieveRelevantChunks({
    courseId: session.course,
    lessonId: session.lesson,
    query: message,
  });

  const context = buildTutorContext({ course, lesson, retrieval, history, question: message });

  return { replay: false, session, course, lesson, userMessage, retrieval, context };
}

/**
 * Records the tutor's answer and advances the session.
 *
 * Shared by the whole-answer path here and the streaming path in Phase 6, including
 * the case where a stream was cut short — `truncated` is what lets a partial answer
 * be persisted so the conversation stays coherent, rather than leaving a question
 * with no reply at all.
 */
export async function persistAnswer({ session, context, text, usage = {}, truncated = false }) {
  const answer = await ChatMessage.create({
    session: session._id,
    course: session.course,
    role: 'assistant',
    content: text,
    truncated,
    model: CHAT_MODEL,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    // The sources the model was ACTUALLY shown, after de-duplication and budgeting —
    // not what retrieval returned, and never anything the model named itself.
    sources: (context?.sources ?? []).map((source) => ({
      chunk: source._id,
      lesson: source.lesson,
      heading: source.heading ?? null,
      blockStart: source.blockStart ?? null,
      score: source.score ?? null,
    })),
  });

  await ChatSession.updateOne(
    { _id: session._id },
    {
      $set: {
        lastMessageAt: answer.createdAt,
        // Written once, from the first question, so a session list reads as a list of
        // questions rather than of ids.
        ...(session.title ? {} : { title: deriveTitle(context) }),
      },
      $inc: { messageCount: 2 },
    }
  );

  return answer;
}

/** A session's name: the student's first question, trimmed to something listable. */
function deriveTitle(context) {
  const question = context?.question ?? '';
  const oneLine = question.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}

/**
 * One complete tutor turn, answer included.
 *
 * The non-streaming path. Phase 6 adds a streaming sibling that shares prepareTurn
 * and persistAnswer with this and differs only in how the answer reaches the client;
 * this one stays, because it is what a non-browser caller and the tests want.
 */
export async function sendMessage({ userId, courseId, sessionId, message, clientMessageId = null }) {
  const startedAt = Date.now();
  const prepared = await prepareTurn({ userId, courseId, sessionId, message, clientMessageId });

  if (prepared.replay) {
    return {
      replay: true,
      userMessage: prepared.userMessage,
      answer: prepared.answer,
      session: prepared.session,
    };
  }

  const { session, context } = prepared;

  const result = await generateChatAnswer({
    systemInstruction: context.systemInstruction,
    contents: context.contents,
  });

  const answer = await persistAnswer({
    session,
    context: { ...context, question: message },
    text: result.text.trim(),
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
  });

  logTurn({
    userId, courseId, sessionId, messageId: answer._id,
    stats: context.stats, retrieval: prepared.retrieval,
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    startedAt,
  });

  return {
    replay: false,
    userMessage: prepared.userMessage,
    answer,
    session,
    stats: context.stats,
    retrievalDegraded: prepared.retrieval.degraded,
  };
}


/**
 * One tutor turn, streamed to an already-open SSE response.
 *
 * Shares prepareTurn and persistAnswer with sendMessage, so retrieval, the prompt,
 * the persisted question and the recorded citations are identical whether the answer
 * arrives in one piece or a token at a time. Only the provider call and the
 * transport differ, which is the whole reason those two were split out.
 *
 * The caller owns the stream and does the authorization; this owns what goes down it.
 *
 * @param {object} params
 * @param {{ send, close, onDisconnect, closed }} params.stream  from openChatStream
 */
export async function streamMessage({ userId, courseId, sessionId, message, clientMessageId = null, stream }) {
  const startedAt = Date.now();
  const prepared = await prepareTurn({ userId, courseId, sessionId, message, clientMessageId });

  /*
   * A replayed retry still streams, rather than returning the stored answer as JSON.
   *
   * The client asked for a stream and has a stream renderer attached; handing it a
   * different response shape for a case it cannot predict would mean every consumer
   * needs two code paths. So the stored answer is emitted as a single token followed
   * by the usual terminal. Nothing is regenerated and nothing is spent.
   */
  if (prepared.replay) {
    stream.send('message_start', {
      messageId: String(prepared.userMessage._id),
      sessionId: String(prepared.session._id),
      replay: true,
    });
    if (prepared.answer) {
      // Stored sources carry ids only; the title and module a citation links with are
      // read from the lessons, for the same reason the read path hydrates them — a
      // renamed lesson must not be cited under a title that no longer exists.
      const [hydrated] = await hydrateSources([prepared.answer]);
      stream.send('sources', { sources: sourcesForWire(hydrated.sources) });
      stream.send('token', { text: prepared.answer.content });
    }
    stream.send('message_complete', {
      messageId: prepared.answer ? String(prepared.answer._id) : null,
      replay: true,
      truncated: Boolean(prepared.answer?.truncated),
    });
    stream.close();
    return { replay: true };
  }

  const { session, context, retrieval } = prepared;

  stream.send('message_start', {
    messageId: String(prepared.userMessage._id),
    sessionId: String(session._id),
    // Tells the client the answer was produced without the course index, so it can
    // say so rather than letting a thin answer look like the course's fault.
    ...(retrieval.degraded ? { retrievalDegraded: true } : {}),
  });

  /*
   * Citations go out BEFORE the first token.
   *
   * Two reasons. The interface can render the source rail immediately instead of
   * waiting for the answer to finish. And, more importantly, these come from the
   * retrieval that actually ran — the model is forbidden from naming sources itself
   * (system prompt rule 4), so there is nothing to wait for it to say.
   */
  stream.send('sources', { sources: sourcesForWire(context.sources) });

  // Cancels the provider call when the reader goes away. Without it an abandoned
  // answer keeps generating, and keeps being billed, against nobody.
  const controller = new AbortController();

  let text = '';
  let usage = {};
  let aborted = false;
  // The metric streaming exists to improve, so it is the one worth measuring.
  let ttftMs = null;

  stream.onDisconnect(() => {
    aborted = true;
    controller.abort();
  });

  try {
    for await (const event of chatStream({
      systemInstruction: context.systemInstruction,
      contents: context.contents,
      abortSignal: controller.signal,
    })) {
      if (event.type === 'token') {
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        text += event.text;
        stream.send('token', { text: event.text });
        continue;
      }

      if (event.type === 'aborted') {
        aborted = true;
        break;
      }

      if (event.type === 'done') {
        usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
      }
    }
  } catch (error) {
    /*
     * Persist whatever arrived before the failure.
     *
     * A question with no reply at all is worse than a short one: the next turn's
     * history would show the student asking and the tutor silently ignoring them,
     * and the model would be reading that as an example of how to behave.
     */
    if (text.trim()) {
      await persistAnswer({
        session, context: { ...context, question: message },
        text: text.trim(), usage, truncated: true,
      });
    }

    logTurn({
      userId, courseId, sessionId, stats: context.stats, retrieval,
      usage, ttftMs, startedAt, truncated: Boolean(text.trim()), failed: true,
    });

    stream.send('message_failed', {
      error: error.message,
      code: error.code ?? 'LLM_ERROR',
      partial: Boolean(text.trim()),
    });
    stream.close();
    return { failed: true };
  }

  /*
   * Persisted even when the reader disconnected mid-answer.
   *
   * The stream is gone, so nothing is sent — but the conversation has to stay
   * coherent for when they come back, and `truncated` is what lets the interface say
   * the answer was cut short instead of presenting half an explanation as complete.
   */
  if (!text.trim()) {
    if (!aborted) {
      stream.send('message_failed', { error: 'The tutor returned an empty answer.', code: 'LLM_EMPTY' });
      stream.close();
    }
    return { failed: true, aborted };
  }

  const answer = await persistAnswer({
    session,
    context: { ...context, question: message },
    text: text.trim(),
    usage,
    truncated: aborted,
  });

  logTurn({
    userId, courseId, sessionId, messageId: answer._id,
    stats: context.stats, retrieval, usage, ttftMs, startedAt, truncated: aborted,
  });

  if (aborted) return { aborted: true, answer };

  stream.send('message_complete', {
    messageId: String(answer._id),
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
  });
  stream.close();

  return { answer };
}

/** Citation payload for the wire. Never the chunk text — see the serializer. */
function sourcesForWire(sources = []) {
  return sources.map((source) => ({
    chunkId: String(source._id ?? source.chunk ?? ''),
    lessonId: String(source.lesson ?? ''),
    lessonTitle: source.lessonTitle ?? null,
    moduleId: source.moduleId ? String(source.moduleId) : null,
    heading: source.heading ?? null,
    blockStart: typeof source.blockStart === 'number' ? source.blockStart : null,
    score: typeof source.score === 'number' ? Number(source.score.toFixed(4)) : null,
  }));
}
