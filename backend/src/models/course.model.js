import mongoose from 'mongoose';
import { tr } from 'zod/v4/locales';

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    learningGoals: {
      type: [String],
      default: [],
      required: true,
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