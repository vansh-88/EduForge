/**
 * Makes text safe for jsPDF's built-in fonts.
 *
 * The standard PDF fonts (helvetica, courier, times) are WinAnsi-encoded, and
 * jsPDF's failure mode for an unencodable character is brutal: it does not drop
 * the character, it **drops the entire string**. A single emoji in a paragraph
 * would silently remove that whole paragraph from the export — measured, not
 * assumed.
 *
 * What survives WinAnsi is broader than it sounds and covers essentially all
 * generated prose: ASCII, Latin-1 accents (é, ï, ñ), and the punctuation an LLM
 * actually produces — em dashes, curly quotes, ellipses, bullets. What does not:
 * arrows, ticks, emoji, and any non-Latin script.
 *
 * So anything outside that set is replaced here rather than left to nuke its
 * paragraph. Losing one glyph is a blemish; losing the sentence around it is a
 * bug the reader would never be able to explain.
 *
 * Note for the planned Hinglish feature: romanised Hinglish is fine, but actual
 * Devanagari needs a font embedded via `doc.addFileToVFS` + `addFont`. It cannot
 * work with the built-ins.
 */

// The 0x80–0x9F slots WinAnsi fills with punctuation rather than control codes.
const WIN_ANSI_EXTRAS = new Set(
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ'
);

// Common symbols worth keeping in a recognisable form rather than dropping.
const TRANSLITERATE = {
  '→': '->', // →
  '▸': '>',  // ▸
  '▶': '>',  // ▶
  '✓': 'v',  // ✓
  '✔': 'v',  // ✔
  '✗': 'x',  // ✗
  '≠': '!=',
  '≤': '<=',
  '≥': '>=',
  ' ': ' ',  // non-breaking space → plain, so wrapping still works
};

// PDF text has no tab stops, so a literal tab renders as nothing.
const TAB_AS_SPACES = '    ';

const isEncodable = (ch) => {
  const code = ch.codePointAt(0);
  // Printable ASCII, or Latin-1 supplement, or a WinAnsi punctuation slot.
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch);
};

/**
 * Returns `text` with every character the built-in fonts cannot encode either
 * transliterated or removed.
 */
export function toPdfSafe(text) {
  const input = String(text ?? '');

  let out = '';
  // Iterated by code point, so a surrogate pair (an emoji) is handled as one
  // character instead of two broken halves.
  for (const ch of input) {
    // Whitespace control characters are handled before the encodability test,
    // which only accepts 0x20 and above. Newline is 0x0A, so without this it
    // was being stripped along with the genuine control codes — collapsing a
    // whole code block into one continuous run of text. splitTextToSize honours
    // newlines, so preserving the character is all that line structure needs.
    if (ch === '\n') {
      out += ch;
      continue;
    }
    if (ch === '\t') {
      out += TAB_AS_SPACES;
      continue;
    }
    // Dropped rather than kept, so a CRLF source does not leave a stray
    // character before every newline.
    if (ch === '\r') continue;

    if (isEncodable(ch)) {
      out += ch;
      continue;
    }

    const replacement = TRANSLITERATE[ch];
    if (replacement !== undefined) out += replacement;
    // Otherwise dropped — better a missing glyph than a missing paragraph.
  }

  // Whitespace is deliberately left exactly as it was. Collapsing runs of
  // spaces would tidy up after a removal, but this function also processes code
  // blocks, where leading indentation is meaning rather than decoration.
  return out;
}
