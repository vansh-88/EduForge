import mongoose from 'mongoose';

const lessonSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      required: true,
    },
    objectives: {
      type: [String],
      required: true,
      default: [],
    },
    content: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    status: {
      type: String,
      enum: ['PENDING', 'GENERATING','PROCESSING', 'READY', 'FAILED', 'RETRYING'],
      default: 'PENDING',
      required: true,
    },
    module: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Module',
      required: true,
    },
    lastError: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: null,
    },
    stage: {
      type: String,
      enum: ['queued', 'preparing_context', 'generating_content', 'validating_content', 'saving', 'completed'],
      default: null,
    },
    progress: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Compound index to guarantee unique ordering per module
lessonSchema.index({ module: 1, order: 1 }, { unique: true });

export const Lesson = mongoose.model('Lesson', lessonSchema);