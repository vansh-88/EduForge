import { Router } from 'express';
import mongoose from 'mongoose';
import { redisConnection } from '../config/index.js';
import { courseGenerationQueue } from '../services/queue/course.queue.js';
import { lessonGenerationQueue } from '../services/queue/lesson.queue.js';


export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running and healthy',
  });
});


// Checks Mongo, Redis, and that the separate worker process is actually up
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
  if (checks.redis) {
    try {
      const [courseWorkers, lessonWorkers] = await Promise.all([
        courseGenerationQueue.getWorkersCount(),
        lessonGenerationQueue.getWorkersCount(),
      ]);
      checks.worker = courseWorkers > 0 && lessonWorkers > 0;
    } catch {
      checks.worker = false;
    }
  }

  const allReady = Object.values(checks).every(Boolean);

  res.status(allReady ? 200 : 503).json({
    success: allReady,
    message: allReady ? 'All systems ready' : 'One or more systems not ready',
    checks,
  });
});
