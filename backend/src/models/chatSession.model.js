import mongoose from 'mongoose';

/**
 * One conversation between a student and the Course Tutor.
 *
 * Scoped to a course, and optionally to a lesson. A null `lesson` is not a
 * missing value — it is the course-level tutor, asked about the course as a
 * whole rather than from inside one lesson. Retrieval still uses `course` as its
 * hard boundary either way, so the two modes differ only in what enters the
 * prompt verbatim.
 *
 * Sessions are created lazily, on the first question rather than when the panel
 * opens. A reader paging through a course would otherwise leave an empty session
 * behind on every lesson they glanced at.
 */
const chatSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    // Null means a course-level conversation. See the note above.
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      default: null,
    },

    // Derived from the first question so a session list reads as a list of
    // questions rather than of ids. Written once, by the first turn.
    title: {
      type: String,
      default: null,
      trim: true,
    },

    // Denormalized from the newest message purely so the session list can be
    // ordered and previewed without touching the messages collection.
    lastMessageAt: {
      type: Date,
      default: null,
    },

    messageCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// The session list: one user's conversations in one course, newest first.
chatSessionSchema.index({ user: 1, course: 1, updatedAt: -1 });

// Cascade on course delete — the same reason VideoSlot and LessonTranslation
// carry a course id: one query rather than a walk down through modules.
chatSessionSchema.index({ course: 1 });

export const ChatSession = mongoose.model('ChatSession', chatSessionSchema);
