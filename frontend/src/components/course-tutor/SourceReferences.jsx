import { Link } from 'react-router-dom';
import { lessonBlockPath } from '../../utils/paths';

/**
 * Where an answer came from.
 *
 * These are determined by the backend from the retrieval that actually ran — the
 * model is forbidden from naming sources itself (system prompt rule 4), precisely so
 * a citation is a fact rather than a sentence. That is what makes it safe to render
 * them as links at all.
 *
 * Each links to the PASSAGE, not just the lesson: `blockStart` is carried from the
 * knowledge index through to here, so a citation on a long lesson lands on the
 * section that was actually used instead of the top of the page.
 *
 * Deduplicated by lesson-and-section. One answer commonly draws several chunks from
 * the same place, and listing a lesson three times reads as noise rather than as
 * evidence — but two genuinely different sections of one lesson are worth showing
 * separately, because they are different things to go and read.
 */
export const SourceReferences = ({ sources = [], courseId }) => {
  if (sources.length === 0) return null;

  const seen = new Map();
  for (const source of sources) {
    if (!source.lessonId || !source.lessonTitle) continue;
    const key = `${source.lessonId}:${source.heading ?? ''}`;
    // Keep the FIRST of a group: sources arrive ranked, so that is the
    // highest-scoring chunk for this section and the best place to send a reader.
    if (!seen.has(key)) seen.set(key, source);
  }

  const unique = [...seen.values()];
  if (unique.length === 0) return null;

  return (
    <div className="mt-2 border-t border-line pt-2">
      <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-faint">
        From your course
      </p>

      <ul className="space-y-0.5">
        {unique.map((source) => {
          // The section is the more precise label; the lesson is the fallback when a
          // chunk sat above the first heading.
          const label = source.heading || source.lessonTitle;
          const sublabel = source.heading ? source.lessonTitle : null;

          // A lesson deleted since the answer was given has no module to route
          // through, so it degrades to plain text rather than a dead link.
          if (!source.moduleId) {
            return (
              <li key={`${source.lessonId}:${source.heading ?? ''}`} className="text-xs text-muted">
                {label}
              </li>
            );
          }

          return (
            <li key={`${source.lessonId}:${source.heading ?? ''}`}>
              <Link
                to={lessonBlockPath(courseId, source.moduleId, source.lessonId, source.blockStart)}
                className="group inline-flex items-baseline gap-1.5 text-xs text-primary-text hover:underline"
              >
                <span>{label}</span>
                {sublabel && (
                  <span className="text-faint group-hover:text-muted">· {sublabel}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
