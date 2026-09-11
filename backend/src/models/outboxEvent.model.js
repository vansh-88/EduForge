import mongoose from 'mongoose';
import { pingWorker } from '../services/worker/wake.js';

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
        'VIDEO_SLOT_RESOLUTION_REQUESTED',
        'LESSON_TRANSLATION_REQUESTED',
        'LESSON_TTS_REQUESTED',
      ],
    },

    aggregateType: {
      type: String,
      required: true,
      enum: ['Course', 'Lesson', 'VideoSlot', 'LessonTranslation', 'LessonAudio'],
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


/*
 * Every new event wakes the worker, if the deployment needs waking.
 *
 * On the schema rather than at the six call sites that create events, because
 * this is a property of "an event exists to be published", not of any one
 * feature — a future event type would otherwise have to remember a step that has
 * nothing to do with what it is for.
 *
 * The ping is fire-and-forget and a no-op unless WORKER_WAKE_URL is set, so it
 * costs a running worker, a single-process deployment, and local development
 * nothing at all. Events created BY the worker never ping, since that variable
 * is only ever set on the API.
 *
 * It fires before the surrounding transaction commits, which is harmless: the
 * worker takes far longer to wake than the commit takes to land, and the
 * publisher polls continuously once it is up.
 */
outboxEventSchema.post('save', function () {
  pingWorker();
});

export const OutboxEvent = mongoose.model('OutboxEvent', outboxEventSchema);