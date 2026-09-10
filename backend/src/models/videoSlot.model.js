import mongoose from 'mongoose';

/**
 * One video placeholder inside a lesson, and the lifecycle of resolving it.
 *
 * Kept in its own collection rather than embedded in the lesson's content array
 * because resolution is quota-bound: a slot may sit unresolved for a day or
 * more, so "every slot still waiting" has to be an indexed query, not a scan of
 * every lesson. It also makes re-resolving slots whose videos were later deleted
 * or made private a single query rather than a migration.
 *
 * The link back to the content block is `slotId`, stamped into the block at
 * persist time the same way MCQ question ids are.
 *
 * Named for the role, not the provider — a second source can be added without
 * touching this schema.
 */
const videoSlotSchema = new mongoose.Schema(
  {
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },

    // Denormalized from the lesson so the course-delete cascade and the
    // course-deleted fan-out can both address slots without joining upward.
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    // Matches the `slotId` on the corresponding content block.
    slotId: {
      type: String,
      required: true,
    },

    // Position of the block within the lesson content, so slots can be listed
    // in reading order without re-scanning the content array.
    order: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      // UNAVAILABLE and FAILED are deliberately distinct: UNAVAILABLE means the
      // provider was searched successfully and nothing suitable came back —
      // a valid outcome, not an error. FAILED means the search itself could not
      // be completed after retries.
      enum: ['PENDING', 'RESOLVING', 'READY', 'UNAVAILABLE', 'FAILED'],
      default: 'PENDING',
      required: true,
    },

    search: {
      primaryQuery: { type: String, required: true },
      // One broader retry, and only one — each search costs 100 quota units.
      fallbackQuery: { type: String, default: null },
      language: { type: String, default: 'en' },
      caption: { type: String, default: null },
    },

    video: {
      provider: { type: String, default: null },
      videoId: { type: String, default: null },
      title: { type: String, default: null },
      channelTitle: { type: String, default: null },
      thumbnailUrl: { type: String, default: null },
      durationSeconds: { type: Number, default: null },
    },

    // Same claim/retry vocabulary as Course and Lesson, so the worker can reuse
    // the compare-and-swap pattern verbatim.
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
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// One slot per block. Also the lookup the lesson read path uses.
videoSlotSchema.index({ lesson: 1, slotId: 1 }, { unique: true });

// The drain query: everything still waiting, oldest first, after a quota reset.
videoSlotSchema.index({ status: 1, createdAt: 1 });

// Cascade on course delete.
videoSlotSchema.index({ course: 1 });

export const VideoSlot = mongoose.model('VideoSlot', videoSlotSchema);
