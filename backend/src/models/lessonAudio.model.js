import mongoose from 'mongoose';

/**
 * A spoken rendering of one lesson, in one voice, and the lifecycle of producing it.
 *
 * The parent row only. The audio itself lives one per segment in
 * LessonAudioSegment, and the bytes live in Cloudinary — never in MongoDB, which
 * is neither a blob store nor a CDN.
 *
 * Like LessonTranslation, this is a derived artifact keyed to a source content
 * hash: the English lesson stays the source of truth and this is regenerated from
 * it when it changes.
 */
const lessonAudioSchema = new mongoose.Schema(
  {
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },

    // Denormalized so the course-delete cascade — which must also purge
    // Cloudinary — is one query rather than a walk down through modules.
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    // Part of the artifact's identity alongside the lesson: a second voice, or a
    // Hinglish reading, is a different artifact rather than a replacement.
    language: {
      type: String,
      default: 'en',
      required: true,
    },
    voice: {
      type: String,
      required: true,
    },

    sourceContentHash: {
      type: String,
      required: true,
    },

    // Same vocabulary as Course, Lesson, VideoSlot and LessonTranslation, so the
    // worker reuses the compare-and-swap pattern and WIRE_STATUS maps these to
    // the wire unchanged.
    status: {
      type: String,
      enum: ['PENDING', 'GENERATING', 'PROCESSING', 'RETRYING', 'READY', 'FAILED'],
      default: 'PENDING',
      required: true,
    },

    stage: {
      type: String,
      enum: ['queued', 'preparing_script', 'synthesizing', 'completed'],
      default: 'queued',
    },

    progress: {
      type: Number,
      default: 0,
    },

    // Denormalized counts so "how far along is this?" is a field read rather than
    // an aggregate over the segment collection on every poll and every SSE snapshot.
    totalSegments: {
      type: Number,
      default: 0,
    },
    readySegments: {
      type: Number,
      default: 0,
    },

    durationSeconds: {
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

// One row per lesson+language+voice. Changing the configured voice produces a
// new artifact rather than silently overwriting audio someone is listening to.
lessonAudioSchema.index({ lesson: 1, language: 1, voice: 1 }, { unique: true });

// Cascade on course delete.
lessonAudioSchema.index({ course: 1 });

export const LessonAudio = mongoose.model('LessonAudio', lessonAudioSchema);
