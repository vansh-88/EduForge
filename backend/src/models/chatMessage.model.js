import mongoose from 'mongoose';

/**
 * One turn in a tutor conversation.
 *
 * Stores what was said, never the prompt that was assembled around it. The
 * assembled prompt is several thousand characters of course content that already
 * exists elsewhere, it would be replayed into the next turn's history, and it is
 * rebuilt from scratch every time anyway — persisting it would multiply the
 * collection's size by the context budget for no readable gain.
 */

/**
 * Which course chunks were supplied to the model for this answer.
 *
 * Embedded rather than given a collection of their own: they are written once
 * with the message, always read with it, and bounded by CHAT_RETRIEVAL_TOP_K.
 *
 * Critically, these come from OUR retrieval, not from anything the model said.
 * A model claiming "according to Lesson 7" is a sentence, not a citation — the
 * backend knows which chunks it supplied, so that is what is recorded and what
 * the reader is shown.
 */
const messageSourceSchema = new mongoose.Schema(
  {
    chunk: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CourseChunk',
      required: true,
    },
    // Denormalized so a citation still renders after a lesson is regenerated and
    // its chunks are replaced. The link degrades to the lesson rather than breaking.
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },
    heading: {
      type: String,
      default: null,
    },
    score: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

const chatMessageSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatSession',
      required: true,
    },

    // Denormalized for the course-delete cascade, exactly as VideoSlot and
    // LessonTranslation do it.
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    // No 'system' role. The system instruction is built from configuration and
    // the course on every turn, so storing it per message would persist a
    // duplicate that could silently drift out of date with the prompt actually used.
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },

    content: {
      type: String,
      required: true,
    },

    // An answer whose stream was cut short — the reader navigated away or the
    // connection dropped. Persisted rather than discarded so the conversation
    // stays coherent, and flagged so the UI can say so instead of presenting half
    // an explanation as a complete one.
    truncated: {
      type: Boolean,
      default: false,
    },

    model: {
      type: String,
      default: null,
    },
    inputTokens: {
      type: Number,
      default: null,
    },
    outputTokens: {
      type: Number,
      default: null,
    },

    sources: {
      type: [messageSourceSchema],
      default: [],
    },

    // Supplied by the client so a network retry re-sends the same question
    // instead of asking it twice. Only user messages carry one.
    clientMessageId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// The conversation itself, in order. Every read of a session uses this.
chatMessageSchema.index({ session: 1, createdAt: 1 });

// The idempotency guarantee. Sparse because assistant messages have no client id
// and a non-sparse unique index would collide on the first two of them.
chatMessageSchema.index(
  { session: 1, clientMessageId: 1 },
  { unique: true, sparse: true }
);

// Cascade on course delete.
chatMessageSchema.index({ course: 1 });

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
