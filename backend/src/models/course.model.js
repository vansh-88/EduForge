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
      index: true,
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
  },
  { timestamps: true }
);

export const Course = mongoose.model('Course', courseSchema);