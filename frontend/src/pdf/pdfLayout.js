import { setFill } from './pdfTheme';

export const PAGE_WIDTH_MM = 210; // A4 portrait
export const PAGE_HEIGHT_MM = 297;
export const MARGIN_MM = 18;
export const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_MM * 2; // 174mm
export const BOTTOM_LIMIT_MM = PAGE_HEIGHT_MM - MARGIN_MM;

/**
 * Points → millimetres.
 *
 * jsPDF sizes fonts in points but positions everything in the document's unit,
 * which here is mm. Every height calculation has to cross that boundary, so it
 * lives in one place rather than as a scattered magic number.
 */
export const pt = (points) => (points * 25.4) / 72;

/** Vertical space one line of `size`pt occupies, including leading. */
export const lineHeight = (size, factor = 1.45) => pt(size) * factor;

/**
 * A writing cursor over a paginated document.
 *
 * Owns the two things every block needs and none of them should re-derive: how
 * far down the page we are, and what to do when the next block will not fit.
 *
 * `ensureSpace` is what keeps logical blocks whole. The architecture doc
 * suggests CSS `break-inside: avoid`, which has no effect here — jsPDF is not a
 * layout engine and there is no CSS involved. The equivalent is asking a block
 * how tall it is *before* drawing it, and starting a new page if it would
 * straddle the boundary.
 */
export function createCursor(doc, theme) {
  let y = MARGIN_MM;

  const paintBackground = () => {
    // A PDF page is white by default. In dark mode that leaves light text
    // invisible, so the canvas has to be painted before anything is drawn on it.
    if (!theme.isDark) return;
    setFill(doc, theme.canvas);
    doc.rect(0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, 'F');
  };

  return {
    get y() {
      return y;
    },

    set y(next) {
      y = next;
    },

    /** Called for page 1 and after every addPage. */
    startPage() {
      paintBackground();
      y = MARGIN_MM;
    },

    newPage() {
      doc.addPage();
      this.startPage();
    },

    /** Space left on the current page. */
    remaining() {
      return BOTTOM_LIMIT_MM - y;
    },

    /**
     * Guarantees `height` mm of room, breaking the page if needed.
     *
     * A block taller than a whole page can never fit, so demanding a fresh page
     * for it would loop or emit a blank one — such blocks are expected to have
     * split themselves already (see the code block chunking).
     */
    ensureSpace(height) {
      if (height <= this.remaining()) return false;
      if (height > BOTTOM_LIMIT_MM - MARGIN_MM) return false;

      this.newPage();
      return true;
    },

    advance(height) {
      y += height;
    },
  };
}
