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
