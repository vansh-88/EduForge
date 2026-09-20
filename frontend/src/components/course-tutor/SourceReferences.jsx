import { Link } from 'react-router-dom';
import { lessonPath } from '../../utils/paths';

/**
 * Where an answer came from.
 *
 * These are determined by the backend from the retrieval that actually ran — the
 * model is forbidden from naming sources itself, precisely so a citation is a fact
 * rather than a sentence. That is why they can be rendered as links at all.
 *
 * Deduplicated by lesson: an answer commonly draws several chunks from one lesson,
 * and listing the same lesson three times reads as noise rather than as evidence.
 */
export const SourceReferences = ({ sources = [], courseId }) => {
  if (sources.length === 0) return null;

  const byLesson = new Map();
  for (const source of sources) {
    if (!source.lessonId || !source.lessonTitle) continue;
    if (!byLesson.has(source.lessonId)) byLesson.set(source.lessonId, source);
  }

  const unique = [...byLesson.values()];
  if (unique.length === 0) return null;

  return (
    <div className="mt-2 border-t border-line pt-2">
      <p className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-faint">
        From your course
      </p>

      <ul className="space-y-0.5">
        {unique.map((source) => (
          <li key={source.lessonId}>
            {/* A lesson deleted since the answer was given has no module to route
                through, so it degrades to plain text rather than a dead link. */}
            {source.moduleId ? (
              <Link
                to={lessonPath(courseId, source.moduleId, source.lessonId)}
                className="text-xs text-primary-text hover:underline"
              >
                {source.lessonTitle}
              </Link>
            ) : (
              <span className="text-xs text-muted">{source.lessonTitle}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
