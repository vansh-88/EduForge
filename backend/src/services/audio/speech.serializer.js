import crypto from 'node:crypto';
import { TTS_SEGMENT_MAX_CHARS, TTS_MAX_SEGMENTS } from '../../config/env.config.js';

/**
 * Turning a lesson's blocks into a script worth listening to.
 *
 * Reading the stored content verbatim would be wrong in both directions: some of
 * it is not speech at all (a code body read character by character is unusable),
 * and some of what a reader needs is carried by layout rather than words.
 *
 * What is spoken:
 *   heading    → announced, and starts a new segment at level 1 or 2
 *   paragraph  → read as-is, with inline markup stripped
 *   code       → a one-line stub naming the language, never the body
 *   video      → skipped
 *   mcq        → skipped
 *
 * MCQs are skipped rather than read because a quiz spoken aloud mid-flow is
 * disorienting, and because the reader's own DTO withholds the answer anyway —
 * speaking the question without being able to speak the outcome is worse than
 * silence. Code gets a stub instead of nothing so a following paragraph saying
 * "as you can see above" still makes sense.
 */

/** Inline markup a reader sees as emphasis but a listener would hear as noise. */
function stripInlineMarkup(text = '') {
  return text
    // `identifier` → identifier: the backticks are punctuation to the eye and
    // gibberish to the ear, but what they wrap is usually a spoken term.
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // [label](url) → label. Reading a URL aloud is never useful.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Headings are written as titles, so they need a full stop to be read as one. */
function asSpokenHeading(text = '') {
  const clean = stripInlineMarkup(text);
  if (!clean) return '';
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function codeStub(block) {
  const language = (block.language ?? '').trim().toLowerCase();
  const named = language && language !== 'plaintext' && language !== 'text';
  return named
    ? `A ${language} code example follows on screen.`
    : 'A code example follows on screen.';
}

/**
 * Splits a lesson into section-sized chunks of speech.
 *
 * Sections are delimited by top-level headings, then subdivided if one runs past
 * the character budget — so the cut lands on a heading wherever the lesson gives
 * us one, and on a paragraph boundary otherwise. Never mid-sentence.
 *
 * Returns `[{ sequence, title, text, textHash }]`, already filtered of anything
 * with nothing to say.
 */
export function lessonToSpeechSegments(content = [], { maxChars = TTS_SEGMENT_MAX_CHARS, maxSegments = TTS_MAX_SEGMENTS } = {}) {
  const segments = [];

  let currentTitle = null;
  let currentParts = [];

  const flush = () => {
    if (currentParts.length === 0) return;
    const text = currentParts.join(' ').trim();
    currentParts = [];
    if (!text) return;
    segments.push({ title: currentTitle, text });
  };

  const add = (piece) => {
    if (!piece) return;

    // Would overflow the budget: close this segment and carry on in a new one
    // under the same heading, rather than splitting a sentence.
    const pending = currentParts.join(' ').length;
    if (pending > 0 && pending + piece.length > maxChars) flush();

    currentParts.push(piece);
  };

  for (const block of content) {
    switch (block?.type) {
      case 'heading': {
        const spoken = asSpokenHeading(block.text);
        // A level 1 or 2 heading is a section break — the natural place to cut.
        // Level 3 is a subheading inside one, so it is announced without
        // starting a new track.
        if ((block.level ?? 2) <= 2) {
          flush();
          currentTitle = stripInlineMarkup(block.text) || currentTitle;
        }
        add(spoken);
        break;
      }

      case 'paragraph':
        add(stripInlineMarkup(block.text));
        break;

      case 'code':
        add(codeStub(block));
        break;

      // Deliberately silent — see the note above.
      case 'video':
      case 'mcq':
      default:
        break;
    }
  }

  flush();

  return segments.slice(0, maxSegments).map((segment, index) => ({
    sequence: index,
    title: segment.title,
    text: segment.text,
    // Identity of the spoken text, so a retry can tell "already made this" from
    // "the lesson changed underneath me".
    textHash: crypto.createHash('sha256').update(segment.text).digest('hex'),
  }));
}
