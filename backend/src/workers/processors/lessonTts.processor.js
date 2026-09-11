import { UnrecoverableError } from 'bullmq';
import { Lesson, LessonAudio, LessonAudioSegment } from '../../models/index.js';
import { ProviderQuotaError, toReaderMessage } from '../../services/ai/providerError.js';
import { synthesizeSpeech } from '../../services/ai/aiService.js';
import { lessonToSpeechSegments } from '../../services/audio/speech.serializer.js';
import { uploadLessonAudioSegment } from '../../services/media/audio.service.js';
import { publishAudioEvent, publishAudioSegmentEvent } from '../../services/realtime/generationEvents.js';
import { hashLessonContent } from '../../utils/contentHash.js';
import { TTS_SEGMENT_DELAY_MS } from '../../config/env.config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setStageAndPublish(audioId, lessonId, state, { stage, progress, attempt, maxAttempts }) {
  state.stage = stage;
  state.progress = progress;

  await LessonAudio.updateOne({ _id: audioId }, { $set: { stage, progress } });
  await publishAudioEvent(lessonId, {
    type: 'audio_progress',
    status: 'generating',
    stage,
    progress,
    attempt,
    maxAttempts,
  });
}

/**
 * Creates the segment rows for this script, preserving any that already exist
 * and still match.
 *
 * This is the half of "resume, don't restart" that lives in the database. A row
 * that is READY for the same textHash is left exactly as it is — same Cloudinary
 * object, same URL — so a job that died after segment four of six comes back and
 * synthesizes only segments five and six.
 */
async function reconcileSegments(audio, script) {
  const existing = await LessonAudioSegment.find({ audio: audio._id }).lean();
  const bySequence = new Map(existing.map((segment) => [segment.sequence, segment]));

  for (const part of script) {
    const previous = bySequence.get(part.sequence);

    // Already spoken, and the words have not changed: keep it.
    if (previous && previous.status === 'READY' && previous.textHash === part.textHash) continue;

    await LessonAudioSegment.findOneAndUpdate(
      { audio: audio._id, sequence: part.sequence },
      {
        $set: {
          lesson: audio.lesson,
          course: audio.course,
          title: part.title,
          text: part.text,
          textHash: part.textHash,
          status: 'PENDING',
          audioUrl: null,
          publicId: null,
          durationSeconds: null,
          bytes: null,
          lastError: null,
        },
      },
      { upsert: true }
    );
  }

  // A shorter script than last time leaves orphans pointing at sections that no
  // longer exist, and they would hold readySegments above totalSegments forever.
  await LessonAudioSegment.deleteMany({
    audio: audio._id,
    sequence: { $gte: script.length },
  });

  return LessonAudioSegment.find({ audio: audio._id }).sort({ sequence: 1 });
}

export async function runLessonTts({ audioId, lessonId, generationId, sourceContentHash, voice, job }) {
  const currentAttempt = (job?.attemptsMade || 0) + 1;
  const maxAttempts = job?.opts?.attempts;

  // 1. ATOMIC CLAIM. A PROCESSING row stamped with OUR generationId is this job's
  // own stranded claim from a killed worker: reclaim it, or the audio stays
  // PROCESSING forever and the reader can never retry. Another cycle's bounces off.
  const claimed = await LessonAudio.findOneAndUpdate(
    {
      _id: audioId,
      $or: [
        { status: { $in: ['GENERATING', 'RETRYING'] } },
        { status: 'PROCESSING', generationId },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        generationId,
        attempts: currentAttempt,
        maxAttempts,
        stage: 'preparing_script',
        progress: 5,
      },
    },
    { returnDocument: 'after' }
  );

  if (!claimed) {
    console.log(`[TtsWorker] Job skipped: audio ${audioId} already claimed, completed, or missing (generation=${generationId}).`);
    return { audioId, status: 'SKIPPED' };
  }

  const state = { stage: 'preparing_script', progress: 5 };

  await publishAudioEvent(lessonId, {
    type: currentAttempt === 1 ? 'audio_started' : 'audio_progress',
    status: 'generating',
    stage: state.stage,
    progress: state.progress,
    attempt: currentAttempt,
    maxAttempts,
  });

  try {
    const lesson = await Lesson.findById(lessonId).lean();

    if (!lesson || lesson.status !== 'READY') {
      throw new Error(`Lesson ${lessonId} is not READY — nothing to read aloud`);
    }

    // The lesson may have been regenerated between the request and this job.
    if (hashLessonContent(lesson.content) !== sourceContentHash) {
      throw new Error('Lesson content changed after the audio was requested');
    }

    const script = lessonToSpeechSegments(lesson.content);

    if (script.length === 0) {
      throw new Error(`Lesson ${lessonId} has nothing speakable`);
    }

    const segments = await reconcileSegments(claimed, script);

    await LessonAudio.updateOne(
      { _id: audioId },
      { $set: { totalSegments: segments.length, readySegments: segments.filter((s) => s.status === 'READY').length } }
    );

    await setStageAndPublish(audioId, lessonId, state, {
      stage: 'synthesizing',
      progress: 10,
      attempt: currentAttempt,
      maxAttempts,
    });

    // 2. One segment at a time. Sequential rather than parallel: the preview TTS
    // model is rate-limited, and the reader gains nothing from segment four
    // arriving early — they need segment one now, which is what publishing each
    // one as it lands already gives them.
    for (const segment of segments) {
      if (segment.status === 'READY' && segment.audioUrl) {
        console.log(`[TtsWorker] segment ${segment.sequence} already done — skipping (resume)`);
        continue;
      }

      await LessonAudioSegment.updateOne({ _id: segment._id }, { $set: { status: 'PROCESSING' } });

      const { audio } = await synthesizeSpeech(segment.text, { voice });

      const uploaded = await uploadLessonAudioSegment(audio, {
        lessonId,
        audioId,
        sequence: segment.sequence,
      });

      // Persist BEFORE announcing: a client that reacts to the event by reading
      // the audio must not find a segment the database does not yet call READY.
      const saved = await LessonAudioSegment.findOneAndUpdate(
        { _id: segment._id },
        { $set: { status: 'READY', lastError: null, ...uploaded } },
        { returnDocument: 'after' }
      );

      const counts = await LessonAudio.findOneAndUpdate(
        { _id: audioId },
        { $inc: { readySegments: 1, durationSeconds: uploaded.durationSeconds ?? 0 } },
        { returnDocument: 'after' }
      );

      // 10 → 95 across the segments; the tail is the final commit.
      const progress = 10 + Math.round((counts.readySegments / segments.length) * 85);
      await LessonAudio.updateOne({ _id: audioId }, { $set: { progress } });
      state.progress = progress;

      // This is what starts playback. The URL rides along because a segment is
      // immutable once READY, so the event cannot disagree with the database —
      // and making the player wait for a round trip would undo the point of
      // segmenting at all.
      await publishAudioSegmentEvent(lessonId, {
        segmentId: String(saved._id),
        sequence: saved.sequence,
        status: 'READY',
        audioUrl: saved.audioUrl,
        title: saved.title,
        durationSeconds: saved.durationSeconds,
      });

      if (TTS_SEGMENT_DELAY_MS > 0) await sleep(TTS_SEGMENT_DELAY_MS);
    }

    // 3. Guarded by our own claim: a slow job must not overwrite a newer cycle's
    // committed audio, nor announce a completion for work it did not do.
    const persisted = await LessonAudio.findOneAndUpdate(
      { _id: audioId, status: 'PROCESSING', generationId },
      {
        $set: {
          status: 'READY',
          stage: 'completed',
          progress: 100,
          lastError: null,
          completedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!persisted) {
      console.log(`[TtsWorker] Nothing persisted for audio ${audioId} (generation=${generationId}) — superseded.`);
      return { audioId, status: 'SKIPPED' };
    }

    await publishAudioEvent(lessonId, {
      type: 'audio_completed',
      status: 'ready',
      stage: 'completed',
      progress: 100,
      attempt: currentAttempt,
      maxAttempts,
    });

    return { audioId, status: 'READY', segments: segments.length };

  } catch (error) {
    // A daily quota rejection is not a transient failure. Every retry is refused
    // in milliseconds, so the default backoff burns all three attempts in about
    // ten seconds and tells the reader "failed after 3 attempts" when the truth
    // is "not until tomorrow". Fail once, say so plainly, and stop.
    const exhausted = error instanceof ProviderQuotaError && error.daily;

    const isFinalAttempt = exhausted || currentAttempt >= maxAttempts;
    const readerMessage = toReaderMessage(error);
    const lastError = readerMessage ?? `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}`;

    // Guarded by our own claim, so a throw after a committed READY cannot demote it.
    await LessonAudio.updateOne(
      { _id: audioId, status: 'PROCESSING', generationId },
      {
        $set: {
          status: isFinalAttempt ? 'FAILED' : 'RETRYING',
          lastError,
          completedAt: null,
        },
      }
    );

    await publishAudioEvent(lessonId, {
      type: isFinalAttempt ? 'audio_failed' : 'audio_retrying',
      status: isFinalAttempt ? 'failed' : 'retrying',
      stage: state.stage,
      progress: state.progress,
      attempt: currentAttempt,
      maxAttempts,
      lastError,
    });

    // Tells BullMQ not to schedule another attempt. Any segments already
    // uploaded stay READY and playable, and remain valid work for a later retry.
    if (exhausted) {
      console.error(`[TtsWorker] 🚫 ${error.message} — not retrying.`);
      throw new UnrecoverableError(lastError);
    }

    throw error;
  }
}
