import mongoose from 'mongoose';
import { connectDB } from '../config/db.config.js';
import { workerConfig } from '../config/worker.config.js';
import { courseWorker } from './course.worker.js';
import { lessonWorker } from './lesson.worker.js';
import { videoWorker } from './video.worker.js';
import {startOutboxPublisher, stopOutboxPublisher} from '../services/outbox/course.publisher.js';
import { startWorkerHeartbeat, stopWorkerHeartbeat } from './heartbeat.js';
import { redisConnection } from '../config/redis.config.js';


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

    // 5. Report liveness to the API's readiness probe. Started last, so it only
    // ever reports a process that is fully wired up.
    startWorkerHeartbeat();
    console.log('✅ Worker heartbeat started');
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