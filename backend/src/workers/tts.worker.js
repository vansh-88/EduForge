import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis.config.js';
import { workerConfig } from '../config/worker.config.js';
import { runLessonTts } from './processors/lessonTts.processor.js';
import { TTS_QUEUE_NAME } from '../services/queue/tts.queue.js';
import { LessonAudio } from '../models/index.js';
import { publishAudioEvent } from '../services/realtime/generationEvents.js';

export const ttsWorker = new Worker(
  TTS_QUEUE_NAME,
  async (job) => {
    const { audioId, lessonId, generationId, sourceContentHash, voice } = job.data;
    const maxAttempts = job.opts.attempts || 3;
    const currentAttempt = job.attemptsMade + 1;

    console.log(`[TtsWorker] ⚙️ Processing job=${job.id} lesson=${lessonId} voice=${voice} generation=${generationId} attempt=${currentAttempt}/${maxAttempts}`);

    await job.updateProgress({ stage: 'TTS_STARTED' });

    return await runLessonTts({ audioId, lessonId, generationId, sourceContentHash, voice, job });
  },
  {
    connection: redisConnection,
    concurrency: workerConfig.tts.concurrency,
    // Far longer than the other workers'. A lesson is a dozen sequential provider
    // calls at roughly twelve seconds each plus an upload apiece, so the default
    // 60s lock would expire mid-job and BullMQ would hand the work to a second
    // worker while the first is still paying for it.
    lockDuration: 600000,
  }
);


ttsWorker.on('completed', (job) => {
  console.log(`[TtsWorker] ✅ Job completed: ${job.id}`);
});


ttsWorker.on('failed', async (job, error) => {
  const maxAttempts = job?.opts?.attempts;
  const currentAttempt = job ? job.attemptsMade : maxAttempts;
  const { audioId, lessonId } = job?.data ?? {};

  // A stall-out is terminal but does NOT bump attemptsMade — BullMQ counts stalls
  // separately and fails the job once it exceeds maxStalledCount. Judging by
  // attemptsMade alone reads that as "will be retried", so we would skip the
  // release below and strand the audio in PROCESSING forever.
  const stalledOut = /stalled more than allowable limit/i.test(error?.message ?? '');

  if (currentAttempt < maxAttempts && !stalledOut) {
    // The message matters here in a way it does not for the cheaper workers: a
    // retried TTS attempt re-spends real synthesis, and `lastError` is cleared
    // the moment a later attempt succeeds — so without this line a run that
    // silently burns an extra attempt every time leaves no trace anywhere.
    console.warn(
      `[TtsWorker] ⚠️ Job attempt ${currentAttempt}/${maxAttempts} failed: ${job?.id}. Scheduled for retry. Cause: ${error?.message ?? 'unknown error'}`
    );
    return;
  }

  console.error(
    stalledOut
      ? `[TtsWorker] ❌ Job stalled past the allowable limit: ${job?.id}.`
      : `[TtsWorker] ❌ Job exhausted all retries (${maxAttempts}): ${job?.id}.`
  );

  if (!audioId) return;

  // Safety net. Normally the processor's catch has already persisted FAILED and
  // this matches nothing — but a job that stalled out never re-enters the
  // processor, so this is the only writer that can release it, and without it the
  // reader's stream never closes.
  //
  // Segments already uploaded are deliberately left READY: they are playable, and
  // they are what makes a later retry cheap.
  try {
    const released = await LessonAudio.findOneAndUpdate(
      { _id: audioId, status: { $in: ['GENERATING', 'PROCESSING', 'RETRYING'] } },
      {
        $set: {
          status: 'FAILED',
          lastError: stalledOut
            ? `Audio generation stalled and was abandoned: ${error?.message ?? 'unknown error'}`
            : `Audio generation failed after ${maxAttempts} attempts: ${error?.message ?? 'unknown error'}`,
          completedAt: null,
        },
      },
      { returnDocument: 'after' }
    );

    if (!released) return;

    console.error(`[TtsWorker] 🚨 Released stranded audio ${audioId} to FAILED.`);

    await publishAudioEvent(lessonId, {
      type: 'audio_failed',
      status: 'FAILED',
      stage: released.stage,
      progress: released.progress,
      attempt: released.attempts,
      maxAttempts: released.maxAttempts ?? maxAttempts,
      lastError: released.lastError,
    });
  } catch (err) {
    console.error(`[TtsWorker] 🚨 Failed to release audio ${audioId}:`, err.message);
  }
});


ttsWorker.on('error', (error) => {
  console.error('[TtsWorker] 🚨 Internal worker error:', error);
});
