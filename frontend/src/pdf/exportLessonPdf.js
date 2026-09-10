import { resolvePdfTheme, setText, setStroke } from './pdfTheme';
import {
  createCursor,
  CONTENT_WIDTH_MM,
  MARGIN_MM,
  PAGE_WIDTH_MM,
  PAGE_HEIGHT_MM,
  lineHeight,
} from './pdfLayout';
import { renderBlock, drawLines, wrap, FONT } from './pdfBlocks';
import { toPdfSafe } from './pdfText';

const slug = (text, fallback) =>
  (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || fallback;

/**
 * Fetches a thumbnail as a data URL.
 *
 * jsPDF draws synchronously, so every image has to be resolved to bytes before
 * layout starts — it cannot await mid-document. Best-effort per image: a
 * failure yields null and the card simply renders without a thumbnail.
 */
async function fetchThumbnail(url) {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;

    const blob = await response.blob();

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function collectThumbnails(content) {
  const wanted = (content ?? []).filter(
    (block) => block.type === 'video' && block.status === 'READY' && block.video?.thumbnailUrl
  );

  const entries = await Promise.all(
    wanted.map(async (block) => [block.video.videoId, await fetchThumbnail(block.video.thumbnailUrl)])
  );

  return Object.fromEntries(entries.filter(([, dataUrl]) => dataUrl));
}

function drawHeader(doc, { cursor, theme }, { lesson, courseTitle, moduleTitle }) {
  if (courseTitle) {
    cursor.advance(
      drawLines(doc, wrap(doc, courseTitle.toUpperCase(), { size: 7.5, style: 'bold' }), {
        y: cursor.y, size: 7.5, style: 'bold', color: theme.muted,
      })
    );
  }

  if (moduleTitle) {
    cursor.advance(
      drawLines(doc, wrap(doc, moduleTitle, { size: 9 }), {
        y: cursor.y, size: 9, color: theme.muted,
      })
    );
  }

  cursor.advance(1.5);
  cursor.advance(
    drawLines(doc, wrap(doc, lesson.title, { size: 18, style: 'bold' }), {
      y: cursor.y, size: 18, style: 'bold', color: theme.ink,
    })
  );

  if (lesson.objectives?.length) {
    cursor.advance(3);
    cursor.advance(
      drawLines(doc, ['IN THIS LESSON'], { y: cursor.y, size: 7, style: 'bold', color: theme.muted })
    );
    cursor.advance(0.5);

    for (const objective of lesson.objectives) {
      const lines = wrap(doc, objective, { size: 9, width: CONTENT_WIDTH_MM - 5 });
      drawLines(doc, ['•'], { y: cursor.y, size: 9, color: theme.primary });
      cursor.advance(
        drawLines(doc, lines, { x: MARGIN_MM + 4, y: cursor.y, size: 9, color: theme.body }) + 0.8
      );
    }
  }

  cursor.advance(3);
  setStroke(doc, theme.ink);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_MM, cursor.y, MARGIN_MM + CONTENT_WIDTH_MM, cursor.y);
  cursor.advance(4);
}

function drawFooters(doc, theme, lessonTitle) {
  const total = doc.getNumberOfPages();
  const baseline = PAGE_HEIGHT_MM - MARGIN_MM / 2;

  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont(FONT.sans, 'normal');
    doc.setFontSize(7.5);
    setText(doc, theme.faint);

    const label = toPdfSafe(`${lessonTitle} · Page ${page} of ${total}`);
    doc.text(doc.splitTextToSize(label, CONTENT_WIDTH_MM - 25)[0], MARGIN_MM, baseline);
    doc.text('EduForge', PAGE_WIDTH_MM - MARGIN_MM, baseline, { align: 'right' });
  }
}

/**
 * Builds the lesson document.
 *
 * Vector rather than a rasterised screenshot, which is what makes the text
 * selectable, searchable and copyable, keeps the file around 50KB instead of
 * megabytes, and lets the video card carry a genuinely clickable link.
 *
 * Takes the palette as an argument rather than reading it, so the document is a
 * pure function of its inputs — no DOM required.
 */
export function buildLessonPdf(jsPDF, { lesson, quizByQuestionId, courseTitle, moduleTitle, theme, thumbnails = {} }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const cursor = createCursor(doc, theme);
  cursor.startPage();

  const ctx = { cursor, theme, thumbnails, quizByQuestionId };

  drawHeader(doc, ctx, { lesson, courseTitle, moduleTitle });

  for (const block of lesson.content ?? []) {
    renderBlock(doc, block, ctx);
  }

  cursor.advance(2);
  const note = `Exported from EduForge on ${new Date().toLocaleDateString()}.`;
  if (cursor.remaining() > lineHeight(7.5) * 2) {
    drawLines(doc, [note], { y: cursor.y, size: 7.5, color: theme.faint });
  }

  drawFooters(doc, theme, lesson.title);

  doc.setProperties({
    title: lesson.title,
    subject: [courseTitle, moduleTitle].filter(Boolean).join(' — ') || 'EduForge lesson',
    author: 'EduForge',
    creator: 'EduForge',
  });

  return doc;
}

/**
 * Exports one lesson as a real, text-based PDF and hands it to the browser.
 *
 * Split from buildLessonPdf so the document can be produced without a download
 * — which is what makes it testable outside a browser, and what would let a
 * future server-side worker reuse the same content→document logic.
 */
export async function exportLessonPdf({ lesson, quizByQuestionId, courseTitle, moduleTitle }) {
  // Dynamic so jsPDF stays out of the main bundle — most visitors never export.
  const { jsPDF } = await import('jspdf');

  // Resolved before any drawing: jsPDF draws synchronously and cannot await
  // mid-document.
  const thumbnails = await collectThumbnails(lesson.content);
  const theme = resolvePdfTheme();

  const doc = buildLessonPdf(jsPDF, {
    lesson, quizByQuestionId, courseTitle, moduleTitle, theme, thumbnails,
  });

  doc.save(`${slug(courseTitle, 'eduforge')}-${slug(lesson.title, 'lesson')}.pdf`);

  return { pages: doc.getNumberOfPages() };
}
