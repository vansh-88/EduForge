import { useState } from 'react';
import { Spinner } from '../../common';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Styling for one option, given what the reader has done and what was correct.
 * Before answering, nothing is coloured — a hover state is the only feedback,
 * so the quiz can't be read by looking at the markup.
 */
const optionStyles = ({ answered, isSelected, isCorrectAnswer }) => {
  if (!answered) {
    return 'border-line bg-surface hover:border-primary hover:bg-primary-soft cursor-pointer';
  }

  // The right answer is always revealed once answered, whether or not it was
  // the one picked — being told only "wrong" teaches nothing.
  if (isCorrectAnswer) return 'border-success bg-success-soft cursor-default';
  if (isSelected) return 'border-danger bg-danger-soft cursor-default';

  return 'border-line bg-surface opacity-60 cursor-default';
};

/**
 * One multiple-choice question.
 *
 * Grading lives on the server: the DTO strips `answer` and `explanation` from
 * unanswered questions, so this component genuinely cannot reveal them early.
 * Everything it shows after answering comes from the submit response or from
 * the restored quiz state.
 *
 * `state` is this question's entry in the lesson's quiz state — either
 * `{ answered: false }` or the full graded record, which is what makes a
 * refresh rebuild the answered UI.
 */
export const McqBlock = ({ block, state, onAnswer }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const answered = Boolean(state?.answered);

  const handleSelect = async (index) => {
    if (answered || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      // 1-based to match the option numbering the backend grades against.
      await onAnswer(block.id, index + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="my-8 rounded-lg border border-line bg-subtle p-5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded bg-subtle px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-body">
          Quiz
        </span>
        <p className="font-medium text-ink">{block.question}</p>
      </div>

      <div className="mt-4 space-y-2">
        {block.options.map((option, index) => {
          const optionNumber = index + 1;
          const isSelected = answered && state.selected === optionNumber;
          const isCorrectAnswer = answered && state.correctAnswer === optionNumber;

          return (
            <button
              key={option}
              type="button"
              disabled={answered || isSubmitting}
              onClick={() => handleSelect(index)}
              className={`flex w-full items-center gap-3 rounded-md border px-4 py-2.5 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-primary ${optionStyles(
                { answered, isSelected, isCorrectAnswer }
              )}`}
            >
              <span className="shrink-0 font-mono text-xs text-faint">
                {LETTERS[index]}
              </span>

              <span className="flex-1 text-ink">{option}</span>

              {isCorrectAnswer && (
                <span className="shrink-0 text-xs font-semibold text-success-text">
                  Correct
                </span>
              )}
              {isSelected && !isCorrectAnswer && (
                <span className="shrink-0 text-xs font-semibold text-danger-text">
                  Your answer
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isSubmitting && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Spinner size="sm" />
          Checking…
        </div>
      )}

      {error && <p className="mt-3 text-xs text-danger-text">{error}</p>}

      {answered && state.explanation && (
        <div className="mt-4 rounded-md border border-line bg-surface p-3">
          <p className="text-xs font-semibold text-body">
            {state.correct ? 'Correct' : 'Not quite'}
          </p>
          <p className="mt-1 text-sm leading-6 text-body">{state.explanation}</p>
        </div>
      )}
    </div>
  );
};
