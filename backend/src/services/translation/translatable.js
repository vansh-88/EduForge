/**
 * Extracting, and putting back, the only parts of a lesson that may be translated.
 *
 * The naive approach — hand the model the whole block array and ask it to return
 * the same structure in Hinglish — puts every load-bearing field at the mercy of
 * a language model: block `type` discriminators, MCQ `answer` indices, `id` and
 * `slotId` values, code bodies. One dropped block silently unlinks every video
 * slot and every recorded quiz answer after it.
 *
 * So the model never sees any of that. It receives a flat list of
 * `{ key, text }` strings and returns the same list translated; the structure is
 * rebuilt here from the original. Corrupting a field the model was never shown
 * is not a failure mode this can have.
 *
 * A side benefit: it sidesteps the fact that only `mcq` and `video` blocks carry
 * stable ids today (see withBlockIds in the lesson generation processor). Keys
 * are positional, so no id backfill is needed.
 */

/** `"<blockIndex>.<field>"`, or `"<blockIndex>.options.<n>"` for MCQ options. */
const keyFor = (index, ...path) => [index, ...path].join('.');

/**
 * Every translatable string in a lesson, in reading order.
 *
 * What is deliberately absent is the point of this function:
 *   - `code.text` and `code.language` — translating a snippet breaks it
 *   - `video.query`  — a search input, never read by a human, and the search
 *                      provider is English-only
 *   - `mcq.answer`   — an index, not prose
 *   - `id`, `slotId`, `type`, `level` — identity and structure
 */
export function extractTranslatableStrings(content = []) {
  const items = [];

  const push = (index, path, text) => {
    if (typeof text !== 'string') return;
    if (!text.trim()) return;
    items.push({ key: keyFor(index, ...path), text });
  };

  content.forEach((block, index) => {
    switch (block?.type) {
      case 'heading':
      case 'paragraph':
        push(index, ['text'], block.text);
        break;

      // Captions are prose about the code; the code itself is not.
      case 'code':
      case 'video':
        push(index, ['caption'], block.caption);
        break;

      case 'mcq':
        push(index, ['question'], block.question);
        (block.options ?? []).forEach((option, optionIndex) => {
          push(index, ['options', optionIndex], option);
        });
        // Translated even though the reader only sees it after answering —
        // otherwise the explanation snaps back to English mid-lesson.
        push(index, ['explanation'], block.explanation);
        break;

      default:
        break;
    }
  });

  return items;
}

/**
 * Rebuilds the lesson's block array with translated strings written back in.
 *
 * Walks the original content rather than the translation map, so a key the model
 * invented addresses nothing and a key it dropped leaves the English string in
 * place. Both are caught earlier by assertTranslationCoverage; this is the second
 * line of defence, and it is what makes a partial result degrade to mixed
 * language rather than to a broken lesson.
 *
 * Blocks are shallow-copied with their untranslated fields carried across
 * verbatim, so `answer`, `id`, `slotId`, `language` and code bodies are preserved
 * by construction.
 */
export function applyTranslations(content = [], translations) {
  const at = (index, ...path) => translations.get(keyFor(index, ...path));

  return content.map((block, index) => {
    switch (block?.type) {
      case 'heading':
      case 'paragraph':
        return { ...block, text: at(index, 'text') ?? block.text };

      case 'code':
      case 'video':
        // `caption` is optional on both; don't introduce the key if it was absent.
        return block.caption === undefined
          ? { ...block }
          : { ...block, caption: at(index, 'caption') ?? block.caption };

      case 'mcq':
        return {
          ...block,
          question: at(index, 'question') ?? block.question,
          options: (block.options ?? []).map(
            (option, optionIndex) => at(index, 'options', optionIndex) ?? option
          ),
          explanation: at(index, 'explanation') ?? block.explanation,
        };

      default:
        return { ...block };
    }
  });
}

/**
 * The model must return exactly the keys it was given — no more, no fewer.
 *
 * A missing key means a silently untranslated paragraph; an unknown key means the
 * model is answering a question nobody asked, which in practice signals it has
 * started improvising structure. Both throw so BullMQ retries rather than
 * persisting a half-translated lesson that looks finished.
 */
export function assertTranslationCoverage(requested, returned) {
  const wanted = new Set(requested.map((item) => item.key));
  const got = new Set(returned.map((item) => item.key));

  const missing = [...wanted].filter((key) => !got.has(key));
  const unknown = [...got].filter((key) => !wanted.has(key));

  if (missing.length === 0 && unknown.length === 0) return;

  const parts = [];
  if (missing.length) parts.push(`missing ${missing.length} key(s): ${missing.slice(0, 5).join(', ')}`);
  if (unknown.length) parts.push(`unexpected ${unknown.length} key(s): ${unknown.slice(0, 5).join(', ')}`);

  throw new Error(`Translation did not cover the requested strings — ${parts.join('; ')}`);
}

/**
 * Splits the string list into batches small enough to translate reliably.
 *
 * A 50-block lesson can produce well over a hundred strings; asking for all of
 * them in one response is where models start truncating and dropping entries —
 * the same degeneration already documented on the lesson schema. Batching by both
 * count and character budget keeps each response short enough to come back whole,
 * and a failure then costs one batch rather than the lesson.
 */
export function batchTranslatableStrings(items, { maxItems, maxChars }) {
  const batches = [];
  let current = [];
  let chars = 0;

  for (const item of items) {
    const wouldOverflow =
      current.length >= maxItems || (current.length > 0 && chars + item.text.length > maxChars);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      chars = 0;
    }

    current.push(item);
    chars += item.text.length;
  }

  if (current.length > 0) batches.push(current);

  return batches;
}
