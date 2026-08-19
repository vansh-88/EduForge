import mongoose from 'mongoose';
import { tr } from 'zod/v4/locales';

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
      type: [String],
      default: [],
      trim: true,
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
      enum: ['GENERATING', 'READY', 'FAILED'],
      default: 'GENERATING',
      required: true,
    },
    modules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Module',
      },
    ],
  },
  { timestamps: true }
);

export const Course = mongoose.model('Course', courseSchema);