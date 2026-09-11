import { Router } from 'express';
import mongoose from 'mongoose';
import { redisConnection } from '../config/redis.config.js';
import { courseGenerationQueue } from '../services/queue/course.queue.js';
import { lessonGenerationQueue } from '../services/queue/lesson.queue.js';
import { videoResolutionQueue } from '../services/queue/video.queue.js';
import { lessonTranslationQueue } from '../services/queue/translation.queue.js';
import { lessonTtsQueue } from '../services/queue/tts.queue.js';
import { readWorkerHeartbeat } from '../workers/heartbeat.js';


export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running and healthy',
  });
});


// Checks Mongo, Redis, and that the separate worker process is actually able to work
healthRouter.get('/ready', async (req, res) => {
  const checks = {
    mongo: mongoose.connection.readyState === 1,
    redis: redisConnection.status === 'ready',
    worker: false,
  };

  // Only probe worker liveness once Redis is confirmed ready — redisConnection
  // is configured with maxRetriesPerRequest: null (retries forever), so issuing
  // a command against a dead connection risks hanging this check instead of
  // failing it fast.
  let workerDetail = { reason: 'redis unavailable' };

  if (checks.redis) {
    // Two independent signals, and BOTH are required.
    //
    // getWorkersCount proves a worker is attached to each queue. It does NOT
    // prove that worker can do anything: one that has lost MongoDB still
    // answers this check while being unable to generate a single lesson. That
    // exact state has been observed here — a transient DNS failure cut the
    // worker off from Atlas while this endpoint reported it healthy.
    //
    // The heartbeat closes that gap by reporting what only the worker process
    // can know: the state of its own MongoDB connection.
    const [queueAttached, heartbeat] = await Promise.all([
      Promise.all([
        courseGenerationQueue.getWorkersCount(),
        lessonGenerationQueue.getWorkersCount(),
        videoResolutionQueue.getWorkersCount(),
        lessonTranslationQueue.getWorkersCount(),
        lessonTtsQueue.getWorkersCount(),
      ])
        .then((counts) => counts.every((count) => count > 0))
        .catch(() => false),

      readWorkerHeartbeat(),
    ]);

    if (!queueAttached) {
      workerDetail = { reason: 'no worker attached to one or more queues' };
    } else if (!heartbeat) {
      workerDetail = { reason: 'no recent worker heartbeat' };
    } else if (!heartbeat.mongo) {
      // The case this whole mechanism exists for.
      workerDetail = { reason: 'worker has lost its MongoDB connection', pid: heartbeat.pid };
    } else {
      checks.worker = true;
      workerDetail = { pid: heartbeat.pid, heartbeatAgeMs: heartbeat.ageMs };
    }
  }

  const allReady = Object.values(checks).every(Boolean);

  res.status(allReady ? 200 : 503).json({
    success: allReady,
    message: allReady ? 'All systems ready' : 'One or more systems not ready',
    checks,
    // Says *why* the worker is unhealthy, so a failing probe is diagnosable
    // without reading the worker's logs.
    worker: workerDetail,
  });
});
