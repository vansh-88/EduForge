import { setText, setFill, setStroke } from './pdfTheme';
import { CONTENT_WIDTH_MM, MARGIN_MM, pt, lineHeight } from './pdfLayout';
import { toPdfSafe } from './pdfText';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const FONT = { sans: 'helvetica', mono: 'courier' };

/**
 * Wraps `text` to `width`mm at the given font, returning the lines.
 *
 * The font must be set before measuring: splitTextToSize uses the *current*
 * font metrics, so measuring in helvetica and drawing in courier would wrap in
 * the wrong places.
 */
function wrap(doc, text, { size, font = FONT.sans, style = 'normal', width = CONTENT_WIDTH_MM }) {
  doc.setFont(font, style);
  doc.setFontSize(size);
  // Sanitised BEFORE measuring, so the wrap points match what is actually drawn.
  return doc.splitTextToSize(toPdfSafe(text), width);
}

/** Draws pre-wrapped lines from `y`, returning the height consumed. */
function drawLines(doc, lines, { x = MARGIN_MM, y, size, font = FONT.sans, style = 'normal', color }) {
  doc.setFont(font, style);
  doc.setFontSize(size);
  if (color) setText(doc, color);

  const lh = lineHeight(size);
  lines.forEach((line, index) => {
    // jsPDF positions text by its baseline, so the first line sits one
    // line-height down from the cursor rather than at it.
    doc.text(toPdfSafe(line), x, y + lh * (index + 1) - pt(size) * 0.25);
  });

  return lh * lines.length;
}

/* -------------------------------------------------------------------------- */

const HEADING_SIZE = { 1: 15, 2: 12.5, 3: 11 };
const HEADING_SPACE = { before: 4, after: 1.5 };

const heading = {
  measure(doc, block) {
    const size = HEADING_SIZE[block.level] ?? HEADING_SIZE[2];
    const lines = wrap(doc, block.text, { size, style: 'bold' });
    return HEADING_SPACE.before + lineHeight(size) * lines.length + HEADING_SPACE.after;
  },
  draw(doc, block, { cursor, theme }) {
    const size = HEADING_SIZE[block.level] ?? HEADING_SIZE[2];
    const lines = wrap(doc, block.text, { size, style: 'bold' });

    cursor.advance(HEADING_SPACE.before);
    const used = drawLines(doc, lines, { y: cursor.y, size, style: 'bold', color: theme.ink });
    cursor.advance(used + HEADING_SPACE.after);
  },
};

const PARA_SIZE = 10;

const paragraph = {
  measure(doc, block) {
    return lineHeight(PARA_SIZE) * wrap(doc, block.text, { size: PARA_SIZE }).length + 2.5;
  },
  draw(doc, block, { cursor, theme }) {
    const lines = wrap(doc, block.text, { size: PARA_SIZE });
    const used = drawLines(doc, lines, { y: cursor.y, size: PARA_SIZE, color: theme.body });
    cursor.advance(used + 2.5);
  },
};

/* -------------------------------------------------------------------------- */

const CODE_SIZE = 8.5;
const CODE_PAD = 3;
const CODE_INSET = CODE_PAD * 2;

/**
 * A code block, chunked across pages when necessary.
 *
 * This is the one block type routinely taller than a page, so rather than being
 * kept whole it draws as many lines as fit, breaks, and continues — repainting
 * its background on each page so a continued block still reads as one panel.
 */
const code = {
  // Reported as the height of a *single* line, so the renderer never tries to
  // reserve a whole oversized block; draw() handles its own pagination.
  measure() {
    return lineHeight(CODE_SIZE) + CODE_PAD * 2;
  },

  draw(doc, block, { cursor, theme }) {
    const lines = wrap(doc, block.text, {
      size: CODE_SIZE,
      font: FONT.mono,
      width: CONTENT_WIDTH_MM - CODE_INSET,
    });

    const lh = lineHeight(CODE_SIZE);
    const label = block.language || 'plaintext';
    let index = 0;
    let first = true;

    cursor.advance(2);

    while (index < lines.length) {
      const labelHeight = first ? lineHeight(7) + 1 : 0;
      let available = cursor.remaining() - CODE_PAD * 2 - labelHeight - 2;

      // Not enough room for even one line — start the continuation on a fresh
      // page rather than emitting a sliver of panel.
      if (available < lh * 2) {
        cursor.newPage();
        available = cursor.remaining() - CODE_PAD * 2 - 2;
      }

      const fit = Math.max(1, Math.floor(available / lh));
      const slice = lines.slice(index, index + fit);
      const panelHeight = slice.length * lh + CODE_PAD * 2 + labelHeight;

      setFill(doc, theme.subtle);
      setStroke(doc, theme.line);
      doc.setLineWidth(0.2);
      doc.roundedRect(MARGIN_MM, cursor.y, CONTENT_WIDTH_MM, panelHeight, 1.5, 1.5, 'FD');

      let inner = cursor.y + CODE_PAD;

      if (first) {
        drawLines(doc, [index === 0 ? label : `${label} (continued)`], {
          x: MARGIN_MM + CODE_PAD,
          y: inner - lineHeight(7) * 0.15,
          size: 7,
          font: FONT.mono,
          color: theme.muted,
        });
        inner += labelHeight;
      }

      drawLines(doc, slice, {
        x: MARGIN_MM + CODE_PAD,
        y: inner,
        size: CODE_SIZE,
        font: FONT.mono,
        color: theme.ink,
      });

      cursor.advance(panelHeight);
      index += slice.length;
      first = index >= lines.length ? first : true;

      if (index < lines.length) cursor.newPage();
    }

    if (block.caption) {
      cursor.advance(1);
      const lines2 = wrap(doc, block.caption, { size: 8 });
      cursor.advance(drawLines(doc, lines2, { y: cursor.y, size: 8, color: theme.muted }));
    }

    cursor.advance(3);
  },
};

/* -------------------------------------------------------------------------- */

const THUMB_W = 40;
const THUMB_H = 22.5; // 16:9

const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * A resolved video as a card with a real, clickable link.
 *
 * Only READY slots appear. PENDING, RESOLVING, UNAVAILABLE and FAILED are all
 * omitted so an export never waits on — or apologises for — enrichment that has
 * not finished.
 */
const video = {
  applies: (block) => block.status === 'READY' && Boolean(block.video?.videoId),

  measure(doc, block, { thumbnails }) {
    const hasThumb = Boolean(thumbnails?.[block.video.videoId]);
    const textWidth = CONTENT_WIDTH_MM - CODE_INSET - (hasThumb ? THUMB_W + 4 : 0);

    const titleLines = wrap(doc, block.video.title || block.caption || 'Related video', {
      size: 10,
      style: 'bold',
      width: textWidth,
    });

    const textHeight =
      lineHeight(10) * titleLines.length +
      (block.video.channelTitle ? lineHeight(8.5) : 0) +
      lineHeight(9) +
      2;

    return Math.max(textHeight, hasThumb ? THUMB_H : 0) + CODE_PAD * 2 + 5;
  },

  draw(doc, block, { cursor, theme, thumbnails }) {
    const thumb = thumbnails?.[block.video.videoId];
    const height = this.measure(doc, block, { thumbnails }) - 5;

    cursor.advance(2);

    setFill(doc, theme.subtle);
    setStroke(doc, theme.line);
    doc.setLineWidth(0.2);
    doc.roundedRect(MARGIN_MM, cursor.y, CONTENT_WIDTH_MM, height, 1.5, 1.5, 'FD');

    // A left rule in the primary colour, so the card reads as a callout rather
    // than another code panel.
    setFill(doc, theme.primary);
    doc.rect(MARGIN_MM, cursor.y, 1, height, 'F');

    let textX = MARGIN_MM + CODE_PAD + 1;
    const top = cursor.y + CODE_PAD;

    if (thumb) {
      try {
        doc.addImage(thumb, 'JPEG', textX, top, THUMB_W, THUMB_H);
        textX += THUMB_W + 4;
      } catch {
        // A corrupt data URL must not take the whole export with it.
      }
    }

    const textWidth = CONTENT_WIDTH_MM - CODE_INSET - (thumb ? THUMB_W + 4 : 0) - 2;
    let y = top;

    const titleLines = wrap(doc, block.video.title || block.caption || 'Related video', {
      size: 10,
      style: 'bold',
      width: textWidth,
    });
    y += drawLines(doc, titleLines, { x: textX, y, size: 10, style: 'bold', color: theme.ink });

    if (block.video.channelTitle) {
      y += drawLines(doc, [block.video.channelTitle], {
        x: textX,
        y,
        size: 8.5,
        color: theme.muted,
      });
    }

    // The whole point of vector output: a link the reader can actually click,
    // rather than a URL printed as a picture of text.
    doc.setFont(FONT.sans, 'bold');
    doc.setFontSize(9);
    setText(doc, theme.primary);
    // Plain ASCII: a decorative glyph here previously dropped the whole label,
    // leaving an invisible but still-clickable link annotation.
    doc.textWithLink('Watch on YouTube >', textX, y + lineHeight(9) * 0.8, {
      url: watchUrl(block.video.videoId),
    });

    cursor.advance(height + 3);
  },
};

/* -------------------------------------------------------------------------- */

const OPTION_SIZE = 9.5;

/**
 * One question.
 *
 * Grading appears only where the client has it: the server sends `correctAnswer`
 * and `explanation` for answered questions only, so an unanswered question
 * prints as a plain self-test revealing nothing.
 */
const mcq = {
  measure(doc, block, ctx) {
    const state = ctx.quizByQuestionId?.[block.id];
    const answered = Boolean(state?.answered);
    const inner = CONTENT_WIDTH_MM - CODE_INSET - 4;

    let height = CODE_PAD * 2 + lineHeight(7) + 1;
    height += lineHeight(10) * wrap(doc, block.question, { size: 10, style: 'bold', width: inner }).length;
    height += 1.5;

    for (const option of block.options) {
      height +=
        lineHeight(OPTION_SIZE) *
          wrap(doc, option, { size: OPTION_SIZE, width: inner - 8 }).length +
        1.6;
    }

    if (answered && state.explanation) {
      height += 2;
      height += lineHeight(9) * wrap(doc, state.explanation, { size: 9, width: inner }).length;
      height += 2;
    }

    return height + 5;
  },

  draw(doc, block, ctx) {
    const { cursor, theme } = ctx;
    const state = ctx.quizByQuestionId?.[block.id];
    const answered = Boolean(state?.answered);
    const inner = CONTENT_WIDTH_MM - CODE_INSET - 4;
    const height = this.measure(doc, block, ctx) - 5;

    cursor.advance(2);

    setFill(doc, theme.subtle);
    setStroke(doc, theme.line);
    doc.setLineWidth(0.2);
    doc.roundedRect(MARGIN_MM, cursor.y, CONTENT_WIDTH_MM, height, 1.5, 1.5, 'FD');

    const x = MARGIN_MM + CODE_PAD + 2;
    let y = cursor.y + CODE_PAD;

    y += drawLines(doc, ['CHECK YOUR UNDERSTANDING'], {
      x, y, size: 7, style: 'bold', color: theme.muted,
    });
    y += 1;

    y += drawLines(doc, wrap(doc, block.question, { size: 10, style: 'bold', width: inner }), {
      x, y, size: 10, style: 'bold', color: theme.ink,
    });
    y += 1.5;

    block.options.forEach((option, index) => {
      const number = index + 1;
      const isCorrect = answered && state.correctAnswer === number;
      const isWrongPick = answered && state.selected === number && !state.correct;

      let color = theme.body;
      if (isCorrect) color = theme.success;
      else if (isWrongPick) color = theme.danger;

      const lines = wrap(doc, option, { size: OPTION_SIZE, width: inner - 8 });

      drawLines(doc, [`${LETTERS[index]}.`], { x, y, size: OPTION_SIZE, style: 'bold', color });
      const used = drawLines(doc, lines, { x: x + 6, y, size: OPTION_SIZE, color });

      if (isCorrect || isWrongPick) {
        doc.setFont(FONT.sans, 'bold');
        doc.setFontSize(7.5);
        setText(doc, color);
        doc.text(
          isCorrect ? 'CORRECT' : 'YOUR ANSWER',
          MARGIN_MM + CONTENT_WIDTH_MM - CODE_PAD - 2,
          y + lineHeight(OPTION_SIZE) * 0.8,
          { align: 'right' }
        );
      }

      y += used + 1.6;
    });

    if (answered && state.explanation) {
      y += 1;
      setStroke(doc, theme.line);
      doc.setLineWidth(0.15);
      doc.line(x, y, MARGIN_MM + CONTENT_WIDTH_MM - CODE_PAD, y);
      y += 1.5;

      y += drawLines(doc, wrap(doc, state.explanation, { size: 9, width: inner }), {
        x, y, size: 9, color: theme.body,
      });
    }

    cursor.advance(height + 3);
  },
};

/* -------------------------------------------------------------------------- */

const RENDERERS = { heading, paragraph, code, video, mcq };

/**
 * Draws one block, breaking the page first if it would not fit whole.
 *
 * Code handles its own pagination (it is routinely taller than a page), so it
 * is excluded from the keep-together check.
 */
export function renderBlock(doc, block, ctx) {
  const renderer = RENDERERS[block.type];

  // Unknown type: thin the document rather than fail the export, matching how
  // BlockRenderer treats a schema that has grown a new block type.
  if (!renderer) return;
  if (renderer.applies && !renderer.applies(block)) return;

  if (block.type !== 'code') {
    const height = renderer.measure(doc, block, ctx);
    ctx.cursor.ensureSpace(height);
  }

  renderer.draw(doc, block, ctx);
}

export { FONT, drawLines, wrap };
