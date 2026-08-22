import mongoose from 'mongoose';

const courseProgressSchema = new mongoose.Schema(
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
    completedLessons: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lesson',
      },
    ],
    lastVisitedLesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      default: null,
    },
    lastVisitedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Exactly one progress document per user/course pair
courseProgressSchema.index({ user: 1, course: 1 }, { unique: true });

// Drives "recently visited" on the dashboard
courseProgressSchema.index({ user: 1, lastVisitedAt: -1 });

export const CourseProgress = mongoose.model('CourseProgress', courseProgressSchema);