import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.config.js';
import { workerConfig } from '../config/worker.config.js';
import { runVideoSlotResolution } from './processors/videoResolution.processor.js';
import { VIDEO_QUEUE_NAME, videoResolutionQueue } from '../services/queue/video.queue.js';
import { QuotaExhaustedError } from '../services/video/videoService.js';
import { settleSlot, announceIfLastSlot } from '../services/video/videoSlot.service.js';

export const videoWorker = new Worker(
  VIDEO_QUEUE_NAME,
  async (job) => {
    const { lessonId, slotId } = job.data;

    // The outbox event id is the job id and is stable across retries, which makes
    // it a natural claim token — no separate generationId has to be threaded
    // through the payload.
    const generationId = job.id;
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = job.attemptsMade + 1;

    console.log(`[VideoWorker] ⚙️ Processing job=${job.id} lesson=${lessonId} slot=${slotId} attempt=${currentAttempt}/${maxAttempts}`);

    try {
      return await runVideoSlotResolution({ lessonId, slotId, generationId, job });
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        // Not a failure — there is simply no budget until the quota resets. Queue
        // a fresh job past the reset and end this one cleanly, so the slot's
        // retry budget is spent on real errors rather than on waiting.
        const delay = error.retryAfterMs;

        console.warn(`[VideoWorker] 💤 Quota exhausted; deferring slot=${slotId} for ${Math.round(delay / 60000)}min`);

        await videoResolutionQueue.add(
          'resolve-video-slot',
          job.data,
          { jobId: `${job.id}-requota-${Date.now()}`, delay }
        );

        return { slotId, status: 'DEFERRED' };
      }

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: workerConfig.video.concurrency,
    lockDuration: 60000,
  }
);


videoWorker.on('completed', (job, result) => {
  console.log(`[VideoWorker] ✅ ${job.id} → ${result?.status ?? 'done'}`);
});


videoWorker.on('failed', async (job, error) => {
  const maxAttempts = job?.opts?.attempts;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;
  const { lessonId, slotId } = job?.data ?? {};

  // Same reasoning as the lesson worker: a stall-out is terminal but does not
  // bump attemptsMade, so judging by attempt count alone would strand the slot.
  const stalledOut = /stalled more than allowable limit/i.test(error?.message ?? '');

  if (currentAttempt < maxAttempts && !stalledOut) {
    console.warn(`[VideoWorker] ⚠️ Attempt ${currentAttempt} failed for ${job?.id}; will retry.`);
    return;
  }

  if (!lessonId || !slotId) return;

  // Safety net. The processor normally settles FAILED itself, in which case this
  // matches nothing. But a stalled job never re-enters the processor, and an
  // unsettled slot holds the lesson's SSE stream open forever — this is the only
  // writer that can release it.
  try {
    const released = await settleSlot({
      slotId,
      lessonId,
      generationId: job.id,
      status: 'FAILED',
      force: true,
      lastError: stalledOut
        ? `Video search stalled and was abandoned: ${error?.message ?? 'unknown error'}`
        : `Video search failed after ${maxAttempts} attempts: ${error?.message ?? 'unknown error'}`,
    });

    if (released) {
      console.error(`[VideoWorker] 🚨 Released stranded slot ${slotId} to FAILED.`);
    } else {
      // Nothing to release, but the lesson may still be waiting on a slot that
      // this job's duplicate already settled.
      await announceIfLastSlot(lessonId);
    }
  } catch (err) {
    console.error(`[VideoWorker] 🚨 Failed to release slot ${slotId}:`, err.message);
  }
});


videoWorker.on('error', (error) => {
  console.error('[VideoWorker] 🚨 Internal worker error:', error);
});
