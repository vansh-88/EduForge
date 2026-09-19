import { blockToText } from '../knowledge/chunking.service.js';
import { buildTutorSystemPrompt, buildTutorUserTurn } from '../ai/prompts/tutorPrompt.js';
import {
  CHAT_CONTEXT_LESSON_MAX_CHARS, CHAT_CONTEXT_RETRIEVED_MAX_CHARS,
  CHAT_CONTEXT_HISTORY_MAX_CHARS, CHAT_HISTORY_MAX_MESSAGES,
} from '../../config/env.config.js';

/**
 * Assembling one tutor turn: what the model is told, and what it is shown.
 *
 * Everything here is governed by a character budget, and the budgets are NOT about
 * the model's context window — flash-lite's window is far larger than anything this
 * builds. They are about cost, time to first token, and answer quality. A prompt
 * padded with marginally relevant course text produces a worse answer than a short
 * one, not a better-informed one: the passage that actually answers the question
 * ends up competing with four that merely resemble it.
 *
 * Characters rather than tokens on purpose. Counting tokens properly means a
 * countTokens round trip to the provider on the latency path of every single
 * message, to refine a budget that is a judgement call to begin with. Four
 * characters to a token is close enough for a limit whose exact value does not
 * matter.
 *
 * When the budget binds, what survives is ordered by how badly the answer needs it:
 *
 *   1. the question            always, in full — it is the whole point
 *   2. the current lesson      what the student is looking at as they ask
 *   3. retrieved course text   the rest of the course, ranked by relevance
 *   4. conversation history    oldest dropped first
 */

/** Cheap token estimate. See the note above on why this is not countTokens. */
const estimateTokens = (text) => Math.ceil((text?.length ?? 0) / 4);

/**
 * Renders a lesson's blocks as prose, stopping at the character budget.
 *
 * Truncation happens at a BLOCK boundary, never mid-block. Half a code block or a
 * multiple-choice question missing two of its options is worse than absent — the
 * model reads it as complete and reasons from a fragment.
 *
 * Reports how far it got, because that is what tells the de-duplication below which
 * retrieved chunks are already on screen.
 */
function renderLesson(lesson, maxChars) {
  const content = lesson?.content ?? [];
  const pieces = [];
  let chars = 0;
  let keptThrough = -1;

  for (let index = 0; index < content.length; index++) {
    const block = content[index];

    // Headings are rendered as headings rather than as bare text, so the model can
    // see the lesson's structure instead of one undifferentiated wall.
    const text = block?.type === 'heading'
      ? `## ${blockToText(block) ?? ''}`.trim()
      : blockToText(block);

    if (!text) {
      // Nothing retrievable in this block (a video's search query, say). It still
      // counts as covered — there is no content here for a chunk to duplicate.
      keptThrough = index;
      continue;
    }

    if (chars > 0 && chars + text.length > maxChars) break;

    pieces.push(text);
    chars += text.length;
    keptThrough = index;
  }

  return {
    text: pieces.join('\n\n'),
    keptThrough,
    truncated: keptThrough < content.length - 1,
  };
}

/**
 * Drops retrieved chunks the current lesson has already shown verbatim.
 *
 * Without this the most relevant chunks — which are usually from the lesson being
 * read, and doubly so once the current-lesson boost has had its say — arrive twice:
 * once inside CURRENT LESSON and again under RELEVANT COURSE MATERIAL. That spends
 * the retrieval budget re-sending text the model already has, and pushes out the
 * passages from OTHER lessons that are the only reason to run a search at all.
 *
 * Only chunks fully inside the kept window are dropped. A chunk that straddles the
 * truncation point carries content the lesson section lost, so it is kept — which is
 * exactly the case a naive "same lesson, therefore duplicate" test would get wrong.
 */
function dropAlreadyVisible(chunks, { lessonId, keptThrough }) {
  if (!lessonId || keptThrough < 0) return { kept: chunks, dropped: 0 };

  const current = String(lessonId);
  const kept = chunks.filter(
    (chunk) => !(String(chunk.lesson) === current && chunk.blockEnd <= keptThrough)
  );

  return { kept, dropped: chunks.length - kept.length };
}

/**
 * Formats retrieved chunks, stopping at the budget.
 *
 * Labelled by lesson and section so the model can tell that two passages come from
 * different places in the course — but note these labels are for the model's
 * reasoning only. It is forbidden from citing them back (system prompt rule 4);
 * citations are attached by the backend from the retrieval that actually ran.
 */
function renderRetrieved(chunks, maxChars) {
  const pieces = [];
  const included = [];
  let chars = 0;

  for (const chunk of chunks) {
    const label = [chunk.lessonTitle, chunk.heading].filter(Boolean).join(' › ') || 'Course material';
    const block = `[${label}]\n${chunk.content}`;

    if (chars > 0 && chars + block.length > maxChars) break;

    pieces.push(block);
    included.push(chunk);
    chars += block.length;
  }

  return { text: pieces.join('\n\n'), included };
}

/**
 * The recent conversation, newest-first until the budget runs out, then restored to
 * chronological order.
 *
 * Whole messages only. A truncated earlier answer is a model contradicting itself
 * later in the same conversation for reasons the student cannot see.
 *
 * Two limits, because they catch different failures: a message count, so a long
 * back-and-forth of one-liners still forgets eventually, and a character budget, so
 * three enormous answers cannot crowd out everything else.
 */
function selectHistory(messages, { maxMessages, maxChars }) {
  const recent = messages.slice(-maxMessages);
  const selected = [];
  let chars = 0;

  for (let index = recent.length - 1; index >= 0; index--) {
    const message = recent[index];
    const length = message.content?.length ?? 0;

    if (selected.length > 0 && chars + length > maxChars) break;

    selected.unshift(message);
    chars += length;
  }

  return { messages: selected, chars, dropped: messages.length - selected.length };
}

/**
 * Builds everything the provider call needs for one tutor turn.
 *
 * Deliberately pure: it performs no database reads and no authorization. Everything
 * it works from is passed in, already authorized by the chat service. That keeps the
 * part of this feature with the most judgement in it — what the model gets to see —
 * testable without a database, a provider key, or a logged-in user.
 *
 * @param {object}   params
 * @param {object}   params.course     { title, difficulty }
 * @param {object}  [params.lesson]    the lesson being read, with its content blocks
 * @param {object}   params.retrieval  the result of retrieveRelevantChunks
 * @param {Array}   [params.history]   prior messages, chronological, [{ role, content }]
 * @param {string}   params.question
 *
 * @returns {{ systemInstruction, contents, sources, stats }}
 *   `sources` is what was ACTUALLY shown to the model, after de-duplication and
 *   budgeting — not what retrieval returned. It is what gets cited and persisted, so
 *   it has to describe the prompt that really happened.
 */
export function buildTutorContext({ course, lesson = null, retrieval, history = [], question }) {
  const systemInstruction = buildTutorSystemPrompt({
    courseTitle: course.title,
    lessonTitle: lesson?.title ?? null,
    difficulty: course.difficulty ?? 'beginner',
  });

  // 1. The current lesson, verbatim and always — never through retrieval.
  //
  // This is what makes the tutor work on a lesson finished thirty seconds ago.
  // Atlas Search indexes are eventually consistent, so a freshly indexed lesson is
  // not yet queryable; routing the open lesson through search would mean the tutor
  // is blind to precisely the page the student is looking at, exactly when they are
  // most likely to ask about it.
  const rendered = lesson
    ? renderLesson(lesson, CHAT_CONTEXT_LESSON_MAX_CHARS)
    : { text: '', keptThrough: -1, truncated: false };

  const lessonSection = rendered.text
    ? `CURRENT LESSON: ${lesson.title}\n${rendered.truncated ? '(shown in part — this lesson is longer than the space available)\n' : ''}\n${rendered.text}`
    : '';

  // 2. Retrieved material from the rest of the course, minus what is already above.
  const { kept, dropped } = dropAlreadyVisible(retrieval?.chunks ?? [], {
    lessonId: lesson?._id,
    keptThrough: rendered.keptThrough,
  });

  const retrieved = renderRetrieved(kept, CHAT_CONTEXT_RETRIEVED_MAX_CHARS);

  const retrievedSection = retrieved.text
    ? `RELEVANT COURSE MATERIAL (from elsewhere in this course):\n\n${retrieved.text}`
    : '';

  // 3. The conversation so far.
  const selectedHistory = selectHistory(history, {
    maxMessages: CHAT_HISTORY_MAX_MESSAGES,
    maxChars: CHAT_CONTEXT_HISTORY_MAX_CHARS,
  });

  // Whether the COURSE had anything to say — not whether retrieval succeeded. A
  // degraded search that returned nothing must not be reported to the model as "the
  // course does not cover this", because it did not establish that.
  const courseCovers = Boolean(lessonSection || retrievedSection) || Boolean(retrieval?.degraded);

  const userTurn = buildTutorUserTurn({
    lessonSection,
    retrievedSection,
    question,
    courseCovers,
  });

  const contents = [
    ...selectedHistory.messages.map((message) => ({
      // Gemini names the assistant role 'model'; everything stored and everything
      // the API returns calls it 'assistant'. Translated here, once.
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    { role: 'user', parts: [{ text: userTurn }] },
  ];

  return {
    systemInstruction,
    contents,
    sources: retrieved.included,
    stats: {
      lessonChars: rendered.text.length,
      lessonTruncated: rendered.truncated,
      retrievedChunks: retrieved.included.length,
      retrievedChars: retrieved.text.length,
      duplicateChunksDropped: dropped,
      historyMessages: selectedHistory.messages.length,
      historyDropped: selectedHistory.dropped,
      estimatedInputTokens:
        estimateTokens(systemInstruction) +
        estimateTokens(userTurn) +
        selectedHistory.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
    },
  };
}
