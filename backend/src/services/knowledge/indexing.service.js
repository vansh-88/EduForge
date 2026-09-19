import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { Lesson, Module, CourseChunk, OutboxEvent } from '../../models/index.js';
import { hashLessonContent } from '../../utils/contentHash.js';
import { chunkLessonContent } from './chunking.service.js';
import { embedTexts } from '../ai/aiService.js';
import { GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '../../config/env.config.js';

/**
 * Turning a lesson into something the tutor can retrieve from.
 *
 * Indexing is strictly derived work. The lesson's block array stays the source of
 * truth and these rows are rebuilt from it, which is why every failure mode here
 * is "rebuild" rather than "repair": there is nothing in a chunk that cannot be
 * regenerated from the lesson it came from.
 */

/**
 * Indexes one lesson, unless it is already indexed at its current content.
 *
 * Idempotent on `(lesson, lessonContentHash)`. That pair is the identity of a
 * chunk set, and it has to be, because the job can arrive more than once by
 * design: BullMQ retries, the outbox publisher rescues stale rows, and the
 * backfill may request a lesson the generation path has already requested. A
 * second run must cost nothing, not produce a second copy.
 *
 * The hash is of the WHOLE lesson rather than of each chunk, because chunk
 * boundaries move when a lesson is regenerated — a per-chunk hash could not
 * answer the only question worth asking here, which is whether this entire set
 * still derives from the lesson as it now stands.
 *
 * @returns {{ status: 'INDEXED' | 'SKIPPED' | 'EMPTY', lessonId, chunkCount }}
 */
export async function indexLesson({ lessonId }) {
  const lesson = await Lesson.findById(lessonId).select('title content status module').lean();

  if (!lesson) {
    // The lesson was deleted between the event being written and this running.
    // Not an error: the cascade already removed its chunks.
    return { status: 'SKIPPED', lessonId, chunkCount: 0, reason: 'lesson no longer exists' };
  }

  if (lesson.status !== 'READY') {
    // A regeneration reclaimed the lesson after this job was queued. Indexing
    // content that is about to be replaced would write a chunk set that is stale
    // the moment it lands; the regeneration will request indexing again when it
    // commits.
    return { status: 'SKIPPED', lessonId, chunkCount: 0, reason: `lesson is ${lesson.status}` };
  }

  const lessonContentHash = hashLessonContent(lesson.content);

  const alreadyIndexed = await CourseChunk.exists({ lesson: lessonId, lessonContentHash });
  if (alreadyIndexed) {
    return { status: 'SKIPPED', lessonId, chunkCount: 0, reason: 'already indexed at this hash' };
  }

  // The module carries the course id; a chunk needs it because `course` is the
  // filter every retrieval scopes to.
  const module = await Module.findById(lesson.module).select('course').lean();

  // An orphan: the lesson outlived the module that owned it, which is what a
  // partially-failed course delete leaves behind. Skipped rather than thrown,
  // because retrying cannot make a deleted module reappear — three attempts and a
  // permanent failure would only be a noisier way of reaching the same place.
  // Warned about, because an orphaned lesson is a symptom worth seeing.
  if (!module?.course) {
    console.warn(`[Knowledge] ⚠️ Lesson ${lessonId} has no reachable course (module=${lesson.module}); skipping.`);
    return { status: 'SKIPPED', lessonId, chunkCount: 0, reason: 'lesson is not reachable from a course' };
  }

  const chunks = chunkLessonContent(lesson);

  if (chunks.length === 0) {
    // A READY lesson with nothing retrievable in it — all video blocks, say.
    // Clear any chunks from a previous version so retrieval cannot return content
    // the lesson no longer contains.
    await CourseChunk.deleteMany({ lesson: lessonId });
    return { status: 'EMPTY', lessonId, chunkCount: 0 };
  }

  // One call for the whole lesson. See the batching note on geminiProvider.embed:
  // this is what makes indexing a back catalogue affordable on a metered key.
  const embeddings = await embedTexts(
    chunks.map((chunk) => chunk.content),
    { taskType: 'RETRIEVAL_DOCUMENT' }
  );

  const documents = chunks.map((chunk, index) => ({
    course: module.course,
    lesson: lesson._id,
    chunkIndex: chunk.chunkIndex,
    heading: chunk.heading,
    content: chunk.content,
    blockStart: chunk.blockStart,
    blockEnd: chunk.blockEnd,
    lessonContentHash,
    embedding: embeddings[index],
    embeddingModel: GEMINI_EMBEDDING_MODEL,
    dims: EMBEDDING_DIMENSIONS,
  }));

  // Replace rather than merge, in one transaction. A lesson's chunk count changes
  // when it is regenerated, so merging would leave the tail of the previous
  // version behind as orphans that still answer queries. Transactional because the
  // window between the delete and the insert is a window in which the tutor has no
  // context for this lesson at all.
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await CourseChunk.deleteMany({ lesson: lesson._id }, { session });
      await CourseChunk.insertMany(documents, { session });
    });
  } finally {
    await session.endSession();
  }

  return { status: 'INDEXED', lessonId, chunkCount: documents.length };
}

/**
 * Requests indexing for every lesson in a course that does not have it.
 *
 * This is the backfill, and it exists because indexing was added after courses
 * already existed. The generation path requests indexing in the transaction that
 * commits a lesson READY, so every lesson made from now on is indexed as a matter
 * of course — but nothing has ever asked for the ones already in the database.
 *
 * Called when a tutor session is created, so a student opening the tutor on an old
 * course starts it indexing rather than being told the course is empty. The first
 * question may still arrive before the index does; the current lesson always
 * enters the prompt verbatim, so the tutor is useful in the meantime.
 *
 * Writes outbox events rather than calling indexLesson directly: this runs on the
 * API process, in the path of a user request, and embedding a whole course there
 * would block that request for as long as the course is large.
 *
 * @returns {{ requested: number }}
 */
export async function ensureCourseIndexed(courseId) {
  const moduleIds = await Module.find({ course: courseId }).distinct('_id');
  if (moduleIds.length === 0) return { requested: 0 };

  const lessons = await Lesson.find({ module: { $in: moduleIds }, status: 'READY' })
    .select('content')
    .lean();

  if (lessons.length === 0) return { requested: 0 };

  // One aggregation for the whole course rather than a query per lesson. It has to
  // pair each lesson WITH its hash — a course-wide set of hashes could only answer
  // "has any lesson been indexed at this content", which is the wrong question.
  // `indexLesson` re-checks this anyway; this pass only avoids queueing work that
  // is certain to be skipped.
  const indexed = new Map(
    (
      await CourseChunk.aggregate([
        { $match: { course: new mongoose.Types.ObjectId(String(courseId)) } },
        { $group: { _id: '$lesson', hashes: { $addToSet: '$lessonContentHash' } } },
      ])
    ).map((row) => [String(row._id), new Set(row.hashes)])
  );

  const stale = lessons.filter(
    (lesson) => !indexed.get(String(lesson._id))?.has(hashLessonContent(lesson.content))
  );

  if (stale.length === 0) return { requested: 0 };

  await OutboxEvent.insertMany(
    stale.map((lesson) => ({
      eventId: crypto.randomUUID(),
      type: 'LESSON_INDEX_REQUESTED',
      aggregateType: 'Lesson',
      aggregateId: lesson._id,
      payload: { lessonId: String(lesson._id), courseId: String(courseId), source: 'backfill' },
    }))
  );

  console.log(`[Knowledge] 📚 Backfill requested indexing for ${stale.length} lesson(s) in course=${courseId}`);

  return { requested: stale.length };
}
