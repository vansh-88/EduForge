import { LessonQuizAttempt } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';


//Every mcq block in a lesson, in content order. Question ids are stamped at generation time (withQuestionIds in the lesson processor).
export function getMcqBlocks(lesson) {
  return (lesson.content ?? []).filter((block) => block?.type === 'mcq');
}

/**
 * Normalizes the answers Map into a plain object. Mongoose hands back a real Map
 * from a hydrated doc but a plain object from .lean(), so callers get one shape.
 */
export function toAnswerMap(attempt) {
  const raw = attempt?.answers;
  if (!raw) return {};
  return raw instanceof Map ? Object.fromEntries(raw) : raw;
}

/**
 * The user's quiz state for a lesson, safe to hand to the client.
 *
 * Grading data is revealed only for questions already answered — the user has
 * seen it, and restoring it is what lets a refresh rebuild the post-answer UI.
 * Unanswered questions leak nothing.
 */
export function buildQuizState(lesson, attempt) {
  const blocks = getMcqBlocks(lesson);
  const answers = toAnswerMap(attempt);

  const questions = blocks.map((block) => {
    const given = answers[block.id];
    if (!given) return { questionId: block.id, answered: false };

    return {
      questionId: block.id,
      answered: true,
      selected: given.selected,
      correct: given.correct,
      correctAnswer: block.answer,
      explanation: block.explanation,
      answeredAt: given.answeredAt,
    };
  });

  const answered = questions.filter((q) => q.answered);

  return {
    total: blocks.length,
    answered: answered.length,
    correct: answered.filter((q) => q.correct).length,
    completed: blocks.length > 0 && answered.length === blocks.length,
    questions,
  };
}

/**
 * Grades one answer and records it. Re-answering a question overwrites the previous
 * response rather than appending, so the attempt always reflects the latest state.
 */
export async function submitAnswer({ userId, courseId, lesson, questionId, selected }) {
  if (lesson.status !== 'READY') {
    throw ApiError.badRequest('Lesson content is not available yet', { code: 'LESSON_NOT_READY' });
  }

  const block = getMcqBlocks(lesson).find((b) => b.id === questionId);

  if (!block) {
    throw ApiError.notFound('Question not found in this lesson', { code: 'QUESTION_NOT_FOUND' });
  }

  // The schema caps `selected` at 4, but the question's own options array is the
  // real bound.
  if (selected > block.options.length) {
    throw ApiError.badRequest(
      `selected must be between 1 and ${block.options.length} for this question`,
      { code: 'ANSWER_OUT_OF_RANGE' }
    );
  }

  const correct = selected === block.answer;

  // Single atomic $set on the Map key: safe under concurrent submissions for the
  // same question, and creates the attempt document on first answer.
  const attempt = await LessonQuizAttempt.findOneAndUpdate(
    { user: userId, lesson: lesson._id },
    {
      $set: { [`answers.${questionId}`]: { selected, correct, answeredAt: new Date() } },
      $setOnInsert: { user: userId, course: courseId, lesson: lesson._id },
    },
    { upsert: true, returnDocument: 'after' }
  );

  const state = buildQuizState(lesson, attempt);

  return {
    questionId,
    selected,
    correct,
    correctAnswer: block.answer,
    explanation: block.explanation,
    progress: {
      answered: state.answered,
      correct: state.correct,
      total: state.total,
      completed: state.completed,
    },
  };
}

export function getAttempt(userId, lessonId) {
  return LessonQuizAttempt.findOne({ user: userId, lesson: lessonId }).lean();
}
