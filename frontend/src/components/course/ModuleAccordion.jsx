import { useState } from 'react';
import { LessonRow } from './LessonRow';

const ChevronIcon = ({ open }) => (
  <svg
    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
      open ? 'rotate-90' : ''
    }`}
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
      clipRule="evenodd"
    />
  </svg>
);

const ModulePanel = ({ module, courseId, completedIds, defaultOpen }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const lessons = module.lessons ?? [];
  const doneCount = lessons.filter((lesson) => completedIds.has(lesson.id)).length;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
      >
        <ChevronIcon open={isOpen} />

        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-400">
            Module {module.order + 1}
          </span>
          <span className="block truncate font-semibold text-gray-900">
            {module.title}
          </span>
        </span>

        <span className="shrink-0 text-xs tabular-nums text-gray-500">
          {doneCount}/{lessons.length}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-100 px-2 py-2">
          {module.goal && (
            <p className="px-3 pb-2 pt-1 text-xs text-gray-500">{module.goal}</p>
          )}

          {lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              courseId={courseId}
              moduleId={module.id}
              completed={completedIds.has(lesson.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The course curriculum: every module, each expandable to its lessons.
 *
 * `openModuleId` is the module the reader is most likely to want — the one
 * holding their resume point. Everything else starts collapsed so a 6-module
 * course is scannable in one screen.
 */
export const ModuleAccordion = ({
  modules = [],
  courseId,
  completedLessonIds = [],
  openModuleId,
}) => {
  const completedIds = new Set(completedLessonIds.map(String));

  return (
    <div className="space-y-3">
      {modules.map((module, index) => (
        <ModulePanel
          key={module.id}
          module={module}
          courseId={courseId}
          completedIds={completedIds}
          // Fall back to the first module so the list is never fully collapsed.
          defaultOpen={openModuleId ? module.id === openModuleId : index === 0}
        />
      ))}
    </div>
  );
};
