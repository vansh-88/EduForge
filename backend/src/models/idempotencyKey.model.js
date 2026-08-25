import mongoose from 'mongoose';

const idempotencyKeySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    key: {
      type: String,
      required: true,
    },

    requestHash: {
      type: String,
      required: true,
    },

    resourceType: {
      type: String,
      required: true,
      enum: ['COURSE_GENERATION', 'LESSON_GENERATION', 'COURSE_RETRY'],
    },

    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    statusCode: {
      type: Number,
      default: 202,
    },

    response: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {timestamps: true,}
);

idempotencyKeySchema.index( { userId: 1, key: 1 }, { unique: true } );

// Replay protection only needs to outlive a client's own retries. Without an expiry
// these accumulate forever and permanently reserve every key ever used.
idempotencyKeySchema.index( { createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 } );

export const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);