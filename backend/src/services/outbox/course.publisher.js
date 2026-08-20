import { OutboxEvent } from '../../models/index.js';
import { courseGenerationQueue } from '../queue/course.queue.js';
import { OUTBOX_POLL_INTERVAL_MS, OUTBOX_BATCH_SIZE, OUTBOX_MAX_ATTEMPTS } from '../../config/index.js';

// Configuration
const OUTBOX_LOCK_TIME_MS = 30_000; // Rescue stuck events after 30 seconds
let stopped = false;
let timeoutId = null;


// Event Router: Maps outbox event types to their respective BullMQ queues.
// Easily extensible for future events.
const EVENT_ROUTER = {
  'COURSE_GENERATION_REQUESTED': async (payload, eventId) => {
    await courseGenerationQueue.add(
      'generate-course',
      payload,
      { jobId: eventId } // BullMQ idempotency lock
    );
  },
};


// Calculates exponential backoff: 1s, 2s, 4s, 8s... capped at 60s.
function calculateBackoff(attempt) {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
}


// Safely claims a batch of events.
// Uses findOneAndUpdate to atomically lock rows, preventing race conditions, if multiple Node processes are running this publisher concurrently.
async function claimEvents() {
  const events = [];
  const now = new Date();
  const staleTime = new Date(Date.now() - OUTBOX_LOCK_TIME_MS);

  for (let i = 0; i < OUTBOX_BATCH_SIZE; i++) {
    const event = await OutboxEvent.findOneAndUpdate(
      {
        nextAttemptAt: { $lte: now },
        $or: [
          { status: 'PENDING' },
          { status: 'PROCESSING', updatedAt: { $lte: staleTime } }, // Rescue crashed jobs
        ],
      },
      {
        $set: { status: 'PROCESSING' },
        $inc: { attempts: 1 },
      },
      {
        returnDocument: 'after',
        sort: { createdAt: 1 }, // Process oldest first
      }
    );

    if (!event) break; // Queue is empty, exit loop early
    events.push(event);
  }

  return events;
}


// Publishes a single event to Redis and marks it completed.
async function publishEvent(event) {
  try {
    const routeHandler = EVENT_ROUTER[event.type];
 
    if (!routeHandler) {
      throw new Error(`Unsupported outbox event type: ${event.type}`);
    }

    // 1. Publish to Redis (BullMQ)
    await routeHandler(event.payload, event.eventId);

    // 2. Mark as successfully published
    await OutboxEvent.updateOne(
      { _id: event._id, status: 'PROCESSING' },
      {
        $set: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          lastError: null,
        },
      }
    );

    console.log(`[Outbox] ✅ Published event=${event.eventId}`);
    
  } catch (error) {
    console.error(`[Outbox] ❌ Failed event=${event.eventId}`, error.message);

    const attempts = event.attempts;

    if (attempts >= OUTBOX_MAX_ATTEMPTS) {
      // Poison pill: mark as FAILED and stop trying
      await OutboxEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: 'FAILED',
            lastError: error.message,
          },
        }
      );
      console.warn(`[Outbox] 🚨 Event ${event.eventId} permanently failed after ${attempts} attempts.`);
      return;
    }

    // Exponential backoff
    const delay = calculateBackoff(attempts);
    await OutboxEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          status: 'PENDING',
          nextAttemptAt: new Date(Date.now() + delay),
          lastError: error.message,
        },
      }
    );
  }
}


// The main polling loop.
async function poll() {
  if (stopped) return;

  try {
    const events = await claimEvents();

    // Process events sequentially to respect ordering and avoid starvation. 
    // or use Promise.all(events.map(publishEvent)) for higher throughput if order doesn't matter.
    for (const event of events) {
      await publishEvent(event);
    }
  } catch (error) {
    console.error('[Outbox] 🚨 Polling error:', error);
  }

  if (!stopped) {
    timeoutId = setTimeout(poll, OUTBOX_POLL_INTERVAL_MS);
  }
}


// Starts the background outbox publisher.
export function startOutboxPublisher() {
  if (!stopped && timeoutId) return; // Prevent multiple loops
  console.log('[Outbox] 🚀 Publisher started');
  stopped = false;
  poll();
}


// Gracefully stops the outbox publisher.
export async function stopOutboxPublisher() {
  stopped = true;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  console.log('[Outbox] 🛑 Publisher stopped');
}