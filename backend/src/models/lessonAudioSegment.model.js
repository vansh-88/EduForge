import mongoose from 'mongoose';

/**
 * One section of a lesson, spoken.
 *
 * Segments exist so playback can start before generation finishes: the preview
 * TTS model takes roughly twelve seconds per sentence, so a whole lesson in one
 * request would be minutes of silence. Cut at section boundaries, the first
 * segment is playable while the rest are still being made.
 *
 * `textHash` is what makes a retry cheap. A job that dies after segment four of
 * six must not re-synthesize — and re-pay for — the four that already exist, so
 * the worker skips any segment already READY whose hash still matches the script
 * it just derived. Without this field a single stall would cost a whole lesson's
 * worth of generation again.
 */
const lessonAudioSegmentSchema = new mongoose.Schema(
  {
    audio: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LessonAudio',
      required: true,
    },

    // Both denormalized: `lesson` for the read path, `course` for the cascade.
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    // Playback order. The player walks these ascending.
    sequence: {
      type: Number,
      required: true,
    },

    // The heading this section came from, so a player can show a track list
    // rather than "Segment 3".
    title: {
      type: String,
      default: null,
    },

    // The exact script sent to the provider — kept so a retry can prove the text
    // has not changed, and so a failure is diagnosable without re-deriving it.
    text: {
      type: String,
      required: true,
    },
    textHash: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'READY', 'FAILED'],
      default: 'PENDING',
      required: true,
    },

    // Cloudinary. `publicId` is kept alongside the URL because deletion is
    // addressed by public id, not by URL.
    audioUrl: {
      type: String,
      default: null,
    },
    publicId: {
      type: String,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: null,
    },
    bytes: {
      type: Number,
      default: null,
    },

    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// One segment per position, and the lookup the read path uses.
lessonAudioSegmentSchema.index({ audio: 1, sequence: 1 }, { unique: true });

// The player fetches every segment for a lesson in order.
lessonAudioSegmentSchema.index({ lesson: 1, sequence: 1 });

// Cascade on course delete.
lessonAudioSegmentSchema.index({ course: 1 });

export const LessonAudioSegment = mongoose.model('LessonAudioSegment', lessonAudioSegmentSchema);
