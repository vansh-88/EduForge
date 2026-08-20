import mongoose from 'mongoose';

const outboxEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      enum: [
        'COURSE_GENERATION_REQUESTED',
        'LESSON_GENERATION_REQUESTED',
      ],
    },

    aggregateType: {
      type: String,
      required: true,
      enum: ['Course', 'Lesson'],
    },

    aggregateId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    status: {
      type: String,
      enum: [
        'PENDING',
        'PROCESSING',
        'PUBLISHED',
        'FAILED',
      ],
      default: 'PENDING',
      required: true,
      index: true,
    },

    attempts: {
      type: Number,
      default: 0,
    },

    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    publishedAt: {
      type: Date,
      default: null,
    },

    lastError: {
      type: String,
      default: null,
    },
  },
  {timestamps: true}
);

outboxEventSchema.index({status: 1, nextAttemptAt: 1});

export const OutboxEvent = mongoose.model('OutboxEvent', outboxEventSchema);