/**
 * Shapes a video block for the reader.
 *
 * The block itself only carries search intent — `query` is a generation input,
 * not something a reader has any use for, so it never leaves the server. What
 * goes out is the slot's resolution state and, once resolved, the video.
 *
 * A block with no matching slot row is reported PENDING rather than dropped:
 * that is the state of a lesson whose enrichment jobs have not run yet, and the
 * reader should see the placeholder, not a hole.
 */
/**
 * One slot's resolution state.
 *
 * Exported because two endpoints read it — the full lesson, and the slot-only
 * poll the client uses to update a single block without refetching a lesson
 * somebody is in the middle of reading. Both go through here so the block shape
 * cannot drift between them.
 *
 * `search` never appears: the queries are generation inputs, of no use to a
 * reader.
 */
export function toVideoSlotDTO(slot) {
  const dto = {
    slotId: slot.slotId,
    status: slot.status,
  };

  if (slot.status === 'READY' && slot.video?.videoId) {
    dto.video = {
      provider: slot.video.provider,
      videoId: slot.video.videoId,
      title: slot.video.title,
      channelTitle: slot.video.channelTitle,
      thumbnailUrl: slot.video.thumbnailUrl,
      durationSeconds: slot.video.durationSeconds,
    };
  }

  return dto;
}

/**
 * A content block with its slot's state merged in.
 *
 * A block with no matching slot row is reported PENDING rather than dropped:
 * that is the state of a lesson whose enrichment jobs have not run yet, and the
 * reader should see the placeholder, not a hole.
 */
function toVideoBlockDTO(block, slotsById) {
  const slot = slotsById?.get(block.slotId);

  return {
    type: 'video',
    caption: block.caption ?? null,
    ...(slot
      ? toVideoSlotDTO(slot)
      : { slotId: block.slotId ?? null, status: 'PENDING' }),
  };
}

/** Counts for the client's "is anything still coming?" check. */
export function toEnrichmentDTO(videoSlots = []) {
  return {
    pending: videoSlots.filter(
      (slot) => slot.status === 'PENDING' || slot.status === 'RESOLVING'
    ).length,
    total: videoSlots.length,
  };
}

/**
 * Strips grading data from lesson content and resolves video slots. Every lesson
 * response must go through this — never return a raw Lesson document.
 */
export function toLessonContentDTO(content = [], slotsById = null) {
  return content.map((block) => {
    if (block.type === 'mcq') {
      const { answer, explanation, ...safe } = block;
      return safe;
    }

    if (block.type === 'video') return toVideoBlockDTO(block, slotsById);

    return block;
  });
}

/**
 * Strips grading data from translated content.
 *
 * Deliberately NOT toLessonContentDTO. That function resolves video blocks
 * against a slot map and reports any block it cannot find as PENDING — correct
 * for a lesson read, wrong here, because a translation has no slots of its own
 * and every resolved video would come back as a spinner. A translated video block
 * carries only its `slotId` and translated `caption`; the client merges it onto
 * the English block, whose live slot state SSE has already been patching.
 *
 * MCQs are stripped exactly as in the English path — a translated `answer` and
 * `explanation` are still the answer key.
 */
function toTranslatedContentDTO(content = []) {
  return content.map((block) => {
    if (block.type === 'mcq') {
      const { answer, explanation, ...safe } = block;
      return safe;
    }

    if (block.type === 'video') {
      return { type: 'video', slotId: block.slotId ?? null, caption: block.caption ?? null };
    }

    return block;
  });
}

/**
 * One audio segment, shaped for the player.
 *
 * `text` never leaves the server: it is a generation input — the script sent to
 * the provider — and the reader already has the lesson it was derived from. What
 * the player needs is where the audio is and how long it runs.
 *
 * A segment that is not READY still ships, carrying a null URL. The player uses
 * the full list to show how many sections are coming and which one it is waiting
 * on; dropping the unfinished ones would leave it unable to tell "still
 * generating" from "that's the end".
 */
export function toAudioSegmentDTO(segment) {
  return {
    segmentId: String(segment._id),
    sequence: segment.sequence,
    title: segment.title ?? null,
    status: segment.status,
    audioUrl: segment.status === 'READY' ? segment.audioUrl : null,
    durationSeconds: segment.durationSeconds ?? null,
  };
}

/**
 * A lesson's audio and all of its segments.
 *
 * Unlike a translation, the segments are returned at every status — audio is
 * usable before it is complete, which is the whole reason it is segmented.
 */
export function toAudioDTO(audio, { lessonId, segments = [] } = {}) {
  return {
    lessonId: String(lessonId ?? audio.lesson),
    audioId: String(audio._id),
    language: audio.language,
    voice: audio.voice,
    status: audio.status,
    totalSegments: audio.totalSegments,
    readySegments: audio.readySegments,
    durationSeconds: audio.durationSeconds,
    segments: [...segments]
      .sort((a, b) => a.sequence - b.sequence)
      .map(toAudioSegmentDTO),
    generation: {
      status: audio.status,
      attempt: audio.attempts,
      maxAttempts: audio.maxAttempts,
      stage: audio.stage,
      progress: audio.progress,
      lastError: audio.status === 'FAILED' ? audio.lastError : null,
      completedAt: audio.completedAt,
    },
  };
}

/**
 * One lesson translation, shaped for the reader.
 *
 * Content is omitted entirely unless READY, so a client cannot render a partial
 * or superseded translation.
 */
export function toTranslationDTO(translation, { lessonId } = {}) {
  const isReady = translation.status === 'READY';

  return {
    lessonId: String(lessonId ?? translation.lesson),
    language: translation.language,
    status: translation.status,
    content: isReady ? toTranslatedContentDTO(translation.content) : null,
    generation: {
      status: translation.status,
      attempt: translation.attempts,
      maxAttempts: translation.maxAttempts,
      stage: translation.stage,
      progress: translation.progress,
      lastError: translation.status === 'FAILED' ? translation.lastError : null,
      completedAt: translation.completedAt,
    },
  };
}

export function toLessonDTO(lesson, { completed = false, videoSlots = [] } = {}) {
  const slotsById = new Map((videoSlots ?? []).map((slot) => [slot.slotId, slot]));

  return {
    id: String(lesson._id),
    title: lesson.title,
    order: lesson.order,
    objectives: lesson.objectives ?? [],
    status: lesson.status,
    content: toLessonContentDTO(lesson.content, slotsById),
    completed,
    generation: {
      status: lesson.status,
      attempt: lesson.attempts,
      maxAttempts: lesson.maxAttempts,
      stage: lesson.stage,
      progress: lesson.progress,
      lastError: lesson.status === 'FAILED' ? lesson.lastError : null,
      startedAt: lesson.startedAt,
      completedAt: lesson.completedAt,
    },
    // Lets the client know whether to expect further video updates on the SSE
    // stream without having to scan the content array itself.
    enrichment: toEnrichmentDTO(videoSlots),
  };
}
