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
      type: String,
      required: true, // Auth0 sub
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
  },
  { timestamps: true }
);

// Compound index to guarantee unique ordering per module
courseSchema.index({ creator: 1,  createdAt: -1 });

export const Course = mongoose.model('Course', courseSchema);