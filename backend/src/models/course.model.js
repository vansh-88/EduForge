import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema(
  {
    query: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    learningGoals: {
      type: [
        {
          type: String,
          trim: true,
          minlength: 1,
        }
      ],
      default: [],
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['GENERATING', 'PROCESSING', 'READY', 'FAILED'],
      default: 'GENERATING',
      required: true,
    },
    modules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Module',
      },
    ],
    lastError: {
      type: String,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner',
      required: true,
    },
    moduleCount: {
      type: Number,
      default: 0,
    },
    lessonCount: {
      type: Number,
      default: 0,
    },
    
  },
  { timestamps: true }
);

// Compound index to guarantee unique ordering per module
courseSchema.index({ creator: 1,  createdAt: -1 });

export const Course = mongoose.model('Course', courseSchema);