/**
 * The application's current colour palette, as jsPDF-ready RGB triples.
 *
 * Read live from the CSS custom properties rather than duplicated here. The
 * `data-theme` attribute lives on <html>, so `getComputedStyle` on that element
 * resolves whichever theme is currently on screen — which is exactly the
 * requirement, and means retuning `index.css` later retunes the PDF with it
 * instead of leaving a second palette to drift.
 */

// Used when a variable is missing or unparseable — a stylesheet that failed to
// load must still produce a readable document rather than throwing mid-export.
const FALLBACK = {
  canvas: '#f9fafb',
  surface: '#ffffff',
  subtle: '#f3f4f6',
  ink: '#111827',
  body: '#374151',
  muted: '#6b7280',
  faint: '#9ca3af',
  line: '#e5e7eb',
  primary: '#2563eb',
  'primary-text': '#1d4ed8',
  success: '#16a34a',
  danger: '#dc2626',
};

const TOKENS = Object.keys(FALLBACK);

/** '#1f2937' or '#fff' → [31, 41, 55]. Returns null on anything else. */
export function hexToRgb(value) {
  const hex = String(value ?? '').trim().replace(/^#/, '');

  if (hex.length === 3) {
    const [r, g, b] = hex;
    return hexToRgb(`${r}${r}${g}${g}${b}${b}`);
  }

  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Snapshots the palette at export time.
 *
 * Taken once and passed down rather than re-read per block: a theme toggle
 * mid-export would otherwise produce a document that changes colour partway
 * through.
 */
export function resolvePdfTheme() {
  let computed = null;
  try {
    computed = getComputedStyle(document.documentElement);
  } catch {
    // No DOM (or a hostile environment) — fall back wholesale.
  }

  const palette = {};

  for (const token of TOKENS) {
    const raw = computed?.getPropertyValue(`--color-${token}`);
    palette[token] = hexToRgb(raw) ?? hexToRgb(FALLBACK[token]);
  }

  // A dark page is not the default in PDF — the canvas has to be painted, and
  // knowing which mode we are in also decides a few contrast choices.
  const isDark = document?.documentElement?.dataset?.theme === 'dark';

  return { ...palette, isDark };
}

/** Applies a palette colour as the text colour. */
export const setText = (doc, rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

/** Applies a palette colour as the fill colour. */
export const setFill = (doc, rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);

/** Applies a palette colour as the stroke colour. */
export const setStroke = (doc, rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
