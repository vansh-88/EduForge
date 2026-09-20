import { useCourseTutor } from '../../hooks/useCourseTutor';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { QuickActions } from './QuickActions';

/**
 * The tutor, docked beside the lesson.
 *
 * Sticky rather than fixed, and inside the page grid rather than floating over it:
 * the reader is meant to consult it WHILE reading, so the lesson must stay visible
 * and the panel must scroll with the article's column rather than pinning itself
 * over the text.
 *
 * Below the lg breakpoint the grid collapses and this renders as a full-width block
 * under the lesson. That is deliberate — a narrow floating drawer over a phone-width
 * lesson hides the thing the question is about.
 *
 * The conversation lives in useCourseTutor's module cache, so closing and reopening
 * the panel keeps it. Only navigating to another lesson resets it.
 */
export const TutorPanel = ({ courseId, lessonId, lessonReady, onClose }) => {
  const tutor = useCourseTutor({ courseId, lessonId });

  return (
    <aside
      aria-label="Course tutor"
      className="flex max-h-[calc(100vh-7rem)] min-h-[20rem] flex-col overflow-hidden rounded-lg border border-line bg-surface lg:sticky lg:top-24"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-ink">Course tutor</h2>
          <p className="text-xs text-muted">Grounded in this course</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close tutor"
          className="rounded-md p-1 text-muted transition hover:bg-subtle hover:text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      {/* Said once, at the top, rather than attached to each answer: it is a property
          of the session, and repeating it under every reply would nag. */}
      {tutor.degraded && (
        <p className="border-b border-warn-line bg-warn-soft px-4 py-1.5 text-xs text-warn-text">
          Your course is still being indexed, so answers may not reach other lessons yet.
        </p>
      )}

      <MessageList
        messages={tutor.messages}
        courseId={courseId}
        onPick={tutor.ask}
        isStreaming={tutor.isStreaming}
      />

      {/* Only once there is an answer to follow up ON, and never mid-stream: these
          all refer to "that", which means nothing before the first reply and means
          something half-written while one is still arriving. */}
      {tutor.hasConversation && !tutor.isStreaming && (
        <QuickActions onPick={tutor.ask} disabled={!lessonReady} />
      )}

      {tutor.error && (
        <p className="border-t border-danger-line bg-danger-soft px-4 py-2 text-xs text-danger-text" role="alert">
          {tutor.error}
        </p>
      )}

      <MessageInput
        onSend={tutor.ask}
        onStop={tutor.stop}
        isStreaming={tutor.isStreaming}
        // A lesson still generating has no content to ground an answer in, so the
        // tutor would be answering about a page that does not exist yet.
        disabled={!lessonReady}
      />
    </aside>
  );
};
