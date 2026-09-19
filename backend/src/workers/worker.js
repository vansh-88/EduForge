import http from 'node:http';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.config.js';
import { WORKER_HTTP, PORT } from '../config/env.config.js';
import { workerConfig } from '../config/worker.config.js';
import { courseWorker } from './course.worker.js';
import { lessonWorker } from './lesson.worker.js';
import { videoWorker } from './video.worker.js';
import { translationWorker } from './translation.worker.js';
import { ttsWorker } from './tts.worker.js';
import { knowledgeWorker } from './knowledge.worker.js';
import {startOutboxPublisher, stopOutboxPublisher} from '../services/outbox/course.publisher.js';
import { startWorkerHeartbeat, stopWorkerHeartbeat } from './heartbeat.js';
import { redisConnection } from '../config/redis.config.js';


/*
 * The worker's own HTTP listener.
 *
 * It exists for the deployment, not for the application: free-tier hosting has
 * no dedicated background-worker service, so the worker runs as a web service —
 * and a web service that binds no port is treated as a failed deploy and killed.
 * Binding one also gives the API a URL to ping, which is how a spun-down worker
 * is woken.
 *
 * Deliberately not an Express app. It answers one question, needs no middleware,
 * and must never become a second place where API routes live.
 */
let workerHttpServer = null;

function startWorkerHttpServer() {
  if (!WORKER_HTTP) return;

  workerHttpServer = http.createServer((req, res) => {
    const mongoUp = mongoose.connection.readyState === 1;

    // Reports this process's own view of itself. The API's /ready is still the
    // endpoint that judges the worker — it reads the Redis heartbeat, which
    // proves the worker is reachable through the same path the jobs take.
    res.writeHead(mongoUp ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: mongoUp,
      role: 'worker',
      pid: process.pid,
      mongo: mongoUp,
      uptimeSeconds: Math.round(process.uptime()),
    }));
  });

  workerHttpServer.listen(PORT, () => {
    console.log(`✅ Worker HTTP listener on port ${PORT}`);
  });
}


async function startWorkers() {
  // 1. Workers need a database connection just like the main API
  try{
    await connectDB();
    console.log('✅ MongoDB connected');

    // 2. Redis connects automatically (if using standard ioredis config), 
    // but we can verify it's ready.
    if (redisConnection.status === 'wait') {
       await redisConnection.connect(); 
    }
    console.log('✅ Redis connected');

    // 3. Start the outbox publisher
    startOutboxPublisher();
    console.log('✅ Outbox publisher started');

    // 4. Workers start on import; log what is now listening.
    console.log('✅ Course generation worker started');
    console.log('✅ Lesson generation worker started');
    console.log('✅ Video resolution worker started');
    console.log('✅ Lesson translation worker started');
    console.log('✅ Lesson TTS worker started');
    console.log('✅ Lesson indexing worker started');

    // 5. Report liveness to the API's readiness probe. Started last, so it only
    // ever reports a process that is fully wired up.
    startWorkerHeartbeat();
    console.log('✅ Worker heartbeat started');

    // 6. Last of all, accept HTTP. The port is what the host reads as "this
    // service is up", so it must not go up before the process can actually work.
    startWorkerHttpServer();
  }
  catch (error) {
    console.error('❌ Worker startup failed:', error);
    process.exit(1);
  }
}


// Handle Graceful Shutdowns (Crucial for BullMQ)
// When scaling down, deploying, or pressing Ctrl+C, we want to let active AI generations finish.
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);

  try {

    // 0. Stop answering HTTP first, so nothing reads this process as healthy
    // while it is shutting down.
    if (workerHttpServer) {
      await new Promise((resolve) => workerHttpServer.close(resolve));
      console.log('✅ Worker HTTP listener stopped.');
    }

    // 1. Stop the outbox publisher
    // Stop advertising liveness first, so the API stops routing readiness green
    // while this process is on its way down.
    await stopWorkerHeartbeat();
    console.log('✅ Worker heartbeat stopped.');

    await stopOutboxPublisher();
    console.log('✅ Outbox publisher stopped.');

    // 2. Stop accepting new jobs and wait for active jobs to finish
    await courseWorker.close();
    console.log('✅ CourseWorker stopped.');
    await lessonWorker.close();
    console.log('✅ LessonWorker stopped.');
    await videoWorker.close();
    console.log('✅ VideoWorker stopped.');
    await translationWorker.close();
    console.log('✅ TranslationWorker stopped.');
    await ttsWorker.close();
    console.log('✅ TtsWorker stopped.');
    await knowledgeWorker.close();
    console.log('✅ KnowledgeWorker stopped.');

    // 3. quit Redis connection
    redisConnection.quit();
    console.log('✅ Redis quitted.');

    // 4. Close MongoDB connection
    await mongoose.disconnect();
    console.log('✅ MongoDB disconnected.');

    console.log('👋 Shutdown complete.');
    process.exit(0);
  } 
  catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}


process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));


startWorkers();