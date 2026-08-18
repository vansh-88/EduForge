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
      default: [],
    },
    content: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    status: {
      type: String,
      enum: ['PENDING', 'GENERATING', 'READY', 'FAILED'],
      default: 'PENDING',
      required: true,
    },
    module: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Module',
      required: true,
    },
  },
  { timestamps: true }
);

// Compound index to guarantee unique ordering per module
lessonSchema.index({ module: 1, order: 1 }, { unique: true });

export const Lesson = mongoose.model('Lesson', lessonSchema);