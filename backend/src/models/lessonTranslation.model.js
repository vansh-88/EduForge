import mongoose from 'mongoose';

/**
 * One lesson rendered into another language, and the lifecycle of producing it.
 *
 * A derived artifact, never a replacement: the English lesson stays the source of
 * truth and this row is regenerated from it. Kept in its own collection rather
 * than embedded in the lesson for the same reason video slots are — it has its
 * own status, its own retries, and is produced long after the lesson is readable.
 *
 * `content` is a block array of exactly the same shape and length as the
 * lesson's, with only natural-language strings replaced. That is guaranteed by
 * construction in services/translation/translatable.js, not by trusting the model.
 */
const lessonTranslationSchema = new mongoose.Schema(
  {
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },

    // Denormalized from the lesson so the course-delete cascade is one query
    // rather than a walk down through modules and lessons — same reason VideoSlot
    // carries it.
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    // Named for the role, not the vendor. The enum is the extension point for
    // Hindi/Spanish later; nothing else in this schema is language-specific.
    language: {
      type: String,
      enum: ['hinglish'],
      required: true,
    },

    // Which version of the English lesson this was translated from. A mismatch
    // against the live lesson means this row is stale — see utils/contentHash.js.
    sourceContentHash: {
      type: String,
      required: true,
    },

    content: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    // Deliberately the same vocabulary Course, Lesson and VideoSlot use, so the
    // worker can reuse the compare-and-swap pattern verbatim and WIRE_STATUS in
    // services/realtime/generationEvents.js maps these to the wire unchanged.
    status: {
      type: String,
      enum: ['PENDING', 'GENERATING', 'PROCESSING', 'RETRYING', 'READY', 'FAILED'],
      default: 'PENDING',
      required: true,
    },

    stage: {
      type: String,
      enum: ['queued', 'translating', 'saving', 'completed'],
      default: 'queued',
    },

    progress: {
      type: Number,
      default: 0,
    },

    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: null,
    },
    generationId: {
      type: String,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// One row per (lesson, language), reused across source hashes rather than kept
// per version. A lesson is effectively immutable once READY here, so a hash
// mismatch is a rare defensive path — and keeping one row bounds growth and makes
// "is there a translation for this lesson?" a single indexed lookup.
lessonTranslationSchema.index({ lesson: 1, language: 1 }, { unique: true });

// Cascade on course delete.
lessonTranslationSchema.index({ course: 1 });

export const LessonTranslation = mongoose.model('LessonTranslation', lessonTranslationSchema);
