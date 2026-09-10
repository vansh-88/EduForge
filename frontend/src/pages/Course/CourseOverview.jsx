import { useParams } from 'react-router-dom';
import { useCourse } from '../../hooks/useCourse';
import { Spinner, ErrorState } from '../../components/common';
import { GenerationProgress } from '../../components/generation/GenerationProgress';
import { COURSE_STAGE_LABELS } from '../../components/generation/stageLabels';

/**
 * PHASE 1 CHECKPOINT BUILD — proves the SSE pipeline end to end.
 * Fleshed out into the real overview page in Phase 2 (module accordion,
 * continue-learning, retry, delete).
 */
export default function CourseOverview() {
  const { courseId } = useParams();
  const { course, progress, generation, isGenerating, isLoading, error } =
    useCourse(courseId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="We couldn't load this course"
        message={error.message}
      />
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">
        {course.title || course.query}
      </h1>

      {isGenerating && (
        <div className="mt-6">
          <GenerationProgress
            generation={generation}
            stageLabels={COURSE_STAGE_LABELS}
            title="Building your course"
          />
        </div>
      )}

      {/* Temporary: the raw contract, so the checkpoint can be verified. */}
      <pre className="mt-6 overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
        {JSON.stringify(
          {
            status: course.status,
            stage: course.stage,
            progress: course.progress,
            moduleCount: course.moduleCount,
            lessonCount: course.lessonCount,
            liveGeneration: generation,
            progressSummary: progress,
          },
          null,
          2
        )}
      </pre>
    </div>
  );
}
