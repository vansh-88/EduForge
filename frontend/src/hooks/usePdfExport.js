import { useCallback, useState } from 'react';
import { getCourse } from '../api/course.api';

// A fixed message, deliberately. The failure modes here are jsPDF internals, a
// blocked fetch, or browser memory — none of which mean anything to a reader,
// and stack traces should never reach the UI. The real cause goes to the
// console for whoever is debugging.
const GENERIC_ERROR = "Couldn't generate the PDF. Please try again.";

/**
 * Exports the current lesson as a PDF.
 *
 * Course and module titles are fetched here, on click, rather than held by the
 * Learn page: the lesson DTO does not carry them, and adding a request to every
 * lesson view to feed an occasional export would be the wrong trade. If that
 * fetch fails the export still runs — a document missing its breadcrumb beats
 * no document.
 */
export const usePdfExport = ({ courseId, moduleId, lesson, quizByQuestionId }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);

  const exportPdf = useCallback(async () => {
    if (isExporting || lesson?.status !== 'READY') return;

    setIsExporting(true);
    setError(null);

    try {
      let courseTitle = null;
      let moduleTitle = null;

      try {
        const { course } = await getCourse(courseId);
        courseTitle = course?.title || course?.query || null;
        moduleTitle = course?.modules?.find((m) => m.id === moduleId)?.title ?? null;
      } catch {
        // Breadcrumb is a nicety; losing it must not lose the export.
      }

      // Imported on demand so jsPDF stays out of the main bundle.
      const { exportLessonPdf } = await import('../pdf/exportLessonPdf');

      // `lesson` is passed as it stands right now — the PDF is a snapshot of the
      // state at click time, so video slots that resolve a moment later belong
      // to the next export, not this one.
      await exportLessonPdf({ lesson, quizByQuestionId, courseTitle, moduleTitle });
    } catch (err) {
      console.error('[PDF export] failed:', err);
      setError(GENERIC_ERROR);
    } finally {
      // Always cleared, so a failure cannot strand the button on "Preparing…".
      setIsExporting(false);
    }
  }, [isExporting, courseId, moduleId, lesson, quizByQuestionId]);

  return { exportPdf, isExporting, error };
};
