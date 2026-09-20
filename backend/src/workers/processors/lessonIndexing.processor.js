import { indexLesson } from '../../services/knowledge/indexing.service.js';

/**
 * Indexes one lesson into the tutor's knowledge base.
 *
 * Markedly thinner than the other processors, and that is a property of the work
 * rather than an omission. The others drive a document through a lifecycle —
 * claim it, stamp a generationId, publish progress, release it on failure — because
 * a reader is watching an SSE stream and needs to be told what is happening.
 *
 * Nothing watches indexing. It is derived data with no status of its own, no
 * surface in the UI, and no stream to close: the reader's lesson is already
 * readable, and the tutor degrades to current-lesson-only context until the index
 * catches up. So there is no document to claim, and a failure needs no release —
 * the chunks simply are not there yet, which is a state the retrieval path already
 * handles.
 *
 * Idempotency lives in indexLesson, keyed on (lesson, lessonContentHash), which is
 * what makes a retried or re-delivered job free rather than duplicative.
 */
export async function runLessonIndexing({ lessonId, courseId, source = 'lesson-generation' }) {
  const started = Date.now();

  const result = await indexLesson({ lessonId });

  const elapsed = Date.now() - started;

  if (result.status === 'INDEXED') {
    console.log(`[KnowledgeWorker] ✅ Indexed lesson=${lessonId} course=${courseId} chunks=${result.chunkCount} in ${elapsed}ms (source=${source})`);
  } else {
    console.log(`[KnowledgeWorker] ⏭️  ${result.status} lesson=${lessonId} course=${courseId}${result.reason ? ` — ${result.reason}` : ''}`);
  }

  return result;
}
