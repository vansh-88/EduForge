// Backend stage names → what the user should read. Kept per kind because
// 'saving' means something different for a curriculum than for a lesson.
// These mirror the `stage` enums on the Course and Lesson models.

export const COURSE_STAGE_LABELS = {
  queued: 'Queued — waiting for a free worker',
  generating_outline: 'Designing your curriculum',
  saving: 'Saving modules and lessons',
  completed: 'Done',
};

export const LESSON_STAGE_LABELS = {
  queued: 'Queued — waiting for a free worker',
  preparing_context: 'Reading the surrounding lessons',
  generating_content: 'Writing this lesson',
  saving: 'Saving content',
  completed: 'Done',
};
