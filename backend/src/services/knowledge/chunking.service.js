import { CHUNK_MAX_CHARS, CHUNK_MIN_CHARS } from '../../config/env.config.js';

/**
 * Cutting a lesson into pieces small enough to retrieve and complete enough to
 * answer from.
 *
 * This is the third walker over the lesson block array, and deliberately not a
 * reuse of either of the others — they exclude exactly what retrieval needs:
 *
 *   extractTranslatableStrings (services/translation/translatable.js)
 *     drops code bodies, because translating a snippet breaks it. A student
 *     asking "what does this loop do?" is asking about the body.
 *
 *   lessonToSpeechSegments (services/audio/speech.serializer.js)
 *     replaces code with a spoken stub and skips MCQs entirely, because neither
 *     reads aloud. But an MCQ with its explanation is some of the densest
 *     teaching material in a lesson — it states a misconception and corrects it,
 *     which is precisely what a confused student is asking about.
 *
 * Folding the three together would mean a flag per caller on every branch, and
 * three features would then share one function that none of them fits.
 *
 * What comes out is one flat list per lesson. Chunk boundaries are positional,
 * like the translation keys, because only `mcq` and `video` blocks carry stable
 * ids (see withBlockIds in the lesson generation processor) — so a chunk records
 * the block range it spans rather than block ids.
 */

/** Roughly a sentence. Used to break an oversized block without splitting mid-word. */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * The text a single block contributes to the index.
 *
 * Returns null for anything with nothing to retrieve on. Note `video`: the
 * `query` field is search intent written for YouTube, never read by a human and
 * frequently a bag of keywords — indexing it would put noise into the corpus
 * that competes with real prose. Its caption is ordinary text about the lesson,
 * so that alone is kept.
 */
function blockToText(block) {
  switch (block?.type) {
    case 'heading':
      return typeof block.text === 'string' ? block.text.trim() : null;

    case 'paragraph':
      return typeof block.text === 'string' ? block.text.trim() : null;

    case 'code': {
      if (typeof block.text !== 'string' || !block.text.trim()) return null;
      // Fenced, with the language, so the model reads it as code rather than as
      // prose that happens to contain semicolons.
      const caption = block.caption ? `${block.caption.trim()}\n` : '';
      return `${caption}\`\`\`${block.language || 'plaintext'}\n${block.text.trim()}\n\`\`\``;
    }

    case 'video':
      return typeof block.caption === 'string' && block.caption.trim()
        ? block.caption.trim()
        : null;

    case 'mcq': {
      if (typeof block.question !== 'string') return null;
      const options = (block.options ?? [])
        .map((option, index) => `${index + 1}. ${option}`)
        .join('\n');
      // The answer index is rendered as the answer's text: "3" means nothing out
      // of context, and a retrieved chunk is always out of context.
      const answerText = block.options?.[block.answer - 1];
      const answer = answerText ? `\nAnswer: ${answerText}` : '';
      const explanation = block.explanation ? `\nWhy: ${block.explanation.trim()}` : '';
      return `Question: ${block.question.trim()}\n${options}${answer}${explanation}`;
    }

    default:
      return null;
  }
}

/**
 * Splits text that is on its own larger than a whole chunk.
 *
 * Rare but real: paragraphs are capped at 5000 characters by the lesson schema
 * and code blocks are not capped at all. Without this, one block would produce a
 * chunk several times the budget, and that chunk would then dominate every
 * prompt it was retrieved into.
 *
 * Split at sentence boundaries where there are any, and at a hard character
 * offset where there are none — which is what a long code block gives you.
 */
function splitOversized(text, limit) {
  if (text.length <= limit) return [text];

  const pieces = [];
  let current = '';

  for (const sentence of text.split(SENTENCE_BOUNDARY)) {
    if (current && current.length + sentence.length + 1 > limit) {
      pieces.push(current);
      current = '';
    }

    if (sentence.length > limit) {
      // No sentence boundaries to use — a code block, or one very long line.
      if (current) {
        pieces.push(current);
        current = '';
      }
      for (let at = 0; at < sentence.length; at += limit) {
        pieces.push(sentence.slice(at, at + limit));
      }
      continue;
    }

    current = current ? `${current} ${sentence}` : sentence;
  }

  if (current) pieces.push(current);

  return pieces;
}

/**
 * Cuts one lesson's block array into retrievable chunks.
 *
 * Boundaries fall at a heading of level 1 or 2 — the lesson's own section breaks,
 * the same ones the audio segmenter cuts at — or when the buffer would exceed
 * CHUNK_MAX_CHARS. A chunk below CHUNK_MIN_CHARS is merged forward rather than
 * emitted, so a one-line section does not become a chunk that competes with real
 * ones on its own; the exception is the last chunk, which has nothing to merge into.
 *
 * Every chunk is prefixed with its breadcrumb — `"<Lesson> › <Heading>"` — so it
 * still says what it is about when it arrives in a prompt with no lesson around it.
 * The breadcrumb is part of the indexed text, not metadata bolted on at read time,
 * so what is retrieved is exactly what was embedded.
 *
 * @param {{ title?: string, content?: Array }} lesson
 * @returns {Array<{ chunkIndex, heading, content, blockStart, blockEnd }>}
 */
export function chunkLessonContent(lesson) {
  const lessonTitle = (lesson?.title ?? '').trim();
  const content = lesson?.content ?? [];

  const chunks = [];

  let heading = null;
  let buffer = [];
  let bufferChars = 0;
  let blockStart = null;
  let blockEnd = null;

  // A lesson's opening heading is usually its own title repeated, which would make
  // every breadcrumb read "Binary Search › Binary Search" and waste the same words
  // in every embedding.
  const breadcrumb = (forHeading) => {
    const parts = forHeading && forHeading !== lessonTitle
      ? [lessonTitle, forHeading]
      : [lessonTitle || forHeading];
    return parts.filter(Boolean).join(' › ');
  };

  const flush = () => {
    if (buffer.length === 0) return;

    const body = buffer.join('\n\n');
    const crumb = breadcrumb(heading);

    chunks.push({
      chunkIndex: chunks.length,
      heading: heading ?? null,
      content: crumb ? `${crumb}\n\n${body}` : body,
      blockStart,
      blockEnd,
    });

    buffer = [];
    bufferChars = 0;
    blockStart = null;
    blockEnd = null;
  };

  const append = (text, index) => {
    buffer.push(text);
    bufferChars += text.length;
    if (blockStart === null) blockStart = index;
    blockEnd = index;
  };

  content.forEach((block, index) => {
    // A top-level heading starts a new section. It is carried into the next
    // chunk's breadcrumb rather than emitted as a chunk of its own — a heading
    // alone is a label, not something anyone can be answered from.
    if (block?.type === 'heading' && (block.level ?? 2) <= 2) {
      flush();
      heading = typeof block.text === 'string' ? block.text.trim() : null;
      return;
    }

    const text = blockToText(block);
    if (!text) return;

    for (const piece of splitOversized(text, CHUNK_MAX_CHARS)) {
      if (bufferChars > 0 && bufferChars + piece.length > CHUNK_MAX_CHARS) flush();
      append(piece, index);
    }
  });

  flush();

  return mergeRunts(chunks);
}

/**
 * Merges chunks below the minimum into the one after them.
 *
 * Done as a pass afterwards rather than inline, because whether a chunk is too
 * small is only knowable once it has been closed — and the natural thing to merge
 * it with is the section that follows, which does not exist yet at that point.
 *
 * The last chunk has nothing after it, so it is merged backwards instead; if it is
 * also the only chunk it is kept whatever its size, since a two-sentence lesson is
 * still a lesson.
 */
function mergeRunts(chunks) {
  if (chunks.length <= 1) return chunks;

  const merged = [];

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];

    if (previous && previous.content.length < CHUNK_MIN_CHARS) {
      previous.content = `${previous.content}\n\n${chunk.content}`;
      previous.blockEnd = chunk.blockEnd;
      // The heading of the larger part is the more useful label.
      previous.heading = previous.heading ?? chunk.heading;
      continue;
    }

    merged.push({ ...chunk });
  }

  // The final chunk may still be a runt; fold it back into its predecessor.
  const last = merged[merged.length - 1];
  if (merged.length > 1 && last.content.length < CHUNK_MIN_CHARS) {
    const previous = merged[merged.length - 2];
    previous.content = `${previous.content}\n\n${last.content}`;
    previous.blockEnd = last.blockEnd;
    merged.pop();
  }

  return merged.map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
}
