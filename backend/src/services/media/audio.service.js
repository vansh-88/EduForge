import { cloudinary } from '../../config/cloudinary.config.js';

/**
 * Where generated lesson audio lives.
 *
 * Cloudinary serves audio under `resource_type: 'video'` — not a mistake, that is
 * simply how its media pipeline is addressed, and it is why the purge below has
 * to name that resource type explicitly or it silently deletes nothing.
 *
 * Uploading WAV and asking for `format: 'mp3'` makes Cloudinary transcode on the
 * way in: measured at roughly a fifth of the bytes, which matters because the
 * reader streams these over the network one segment at a time.
 *
 * Unlike avatars (services/media/avatar.service.js), nothing here is client-side
 * — these bytes are produced by the worker and never touch the browser on the way
 * up, so there is no signature to issue and no upload to verify after the fact.
 */

/** Everything for one lesson lives under one prefix, so the cascade is one call. */
export function lessonAudioFolder(lessonId) {
  return `eduforge/tts/${lessonId}`;
}

/**
 * Uploads one segment's audio and returns what the segment row needs.
 *
 * `public_id` is derived server-side from ids the caller already holds, so a
 * re-run of the same segment overwrites its own object rather than accumulating
 * orphans — the storage-side half of the worker's resume behaviour.
 */
export async function uploadLessonAudioSegment(buffer, { lessonId, audioId, sequence }) {
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: lessonAudioFolder(lessonId),
        public_id: `${audioId}-${sequence}`,
        format: 'mp3',
        overwrite: true,
        invalidate: true,
      },
      (error, uploaded) => (error ? reject(error) : resolve(uploaded))
    );

    stream.end(buffer);
  });

  return {
    audioUrl: result.secure_url,
    publicId: result.public_id,
    // Cloudinary's own measurement of the transcoded file, which is more
    // trustworthy than arithmetic over the PCM we sent it.
    durationSeconds: result.duration ?? null,
    bytes: result.bytes ?? null,
  };
}

/**
 * Removes every audio object for a lesson.
 *
 * Best-effort by design: it is called from the course-delete cascade, and a
 * Cloudinary outage must not fail a delete the user asked for and that MongoDB
 * has already committed. An orphaned object costs storage; a failed delete costs
 * the user their request.
 */
export async function destroyLessonAudio(lessonId) {
  try {
    await cloudinary.api.delete_resources_by_prefix(lessonAudioFolder(lessonId), {
      resource_type: 'video',
    });
  } catch (error) {
    console.error(`[LessonAudio] Cloudinary purge failed for lesson ${lessonId}:`, error.message);
  }
}
