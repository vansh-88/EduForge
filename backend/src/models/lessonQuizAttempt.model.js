import mongoose from 'mongoose';

const quizAnswerSchema = new mongoose.Schema(
  {
    selected: {
      type: Number,
      required: true,
      min: 1, // 1-based
    },
    correct: {
      type: Boolean,
      required: true,
    },
    answeredAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const lessonQuizAttemptSchema = new mongoose.Schema(
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
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },
    // Keyed by the questionId stamped onto each mcq block at generation time.
    // A Map rather than an array so re-answering one question is a single atomic
    // $set — an array would need a pull+push, which cannot be done in one update
    // and would let concurrent submissions duplicate an entry.
    answers: {
      type: Map,
      of: quizAnswerSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

// One attempt record per user per lesson; re-answering updates it in place.
lessonQuizAttemptSchema.index({ user: 1, lesson: 1 }, { unique: true });

// Supports course-wide reads (e.g. a results overview) without a scan.
lessonQuizAttemptSchema.index({ user: 1, course: 1 });

export const LessonQuizAttempt = mongoose.model('LessonQuizAttempt', lessonQuizAttemptSchema);
