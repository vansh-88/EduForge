import mongoose from 'mongoose';
import { connectDB } from '../config/db.config.js';
import {
  Course, Module, Lesson, CourseProgress, LessonQuizAttempt, VideoSlot, LessonTranslation,
  LessonAudio, LessonAudioSegment, ChatSession, ChatMessage, CourseChunk,
} from '../models/index.js';

/**
 * Finds — and optionally removes — documents whose owner no longer exists.
 *
 * This exists because the delete cascade used to be interruptible: the Course was
 * removed first and its children were swept afterwards, outside any transaction, so
 * a process that died partway through left documents that nothing could ever reach
 * again. Both cascades are transactional now (services/course/cascade.js), so
 * nothing new can land here — but the wreckage already written does not clean itself.
 *
 *   npm run repair-orphans          report only
 *   npm run repair-orphans -- --fix actually delete
 *
 * Read-only by default, on purpose. This deletes user data, and a maintenance script
 * that does that as its default behaviour is one bad invocation away from being the
 * incident it was written to clean up after.
 */

const FIX = process.argv.includes('--fix');

/** An id set, for membership tests. distinct() is far cheaper than loading documents. */
const idSet = async (Model, field = '_id', filter = {}) =>
  new Set((await Model.find(filter).distinct(field)).map(String));

async function main() {
  await connectDB();

  const courseIds = await idSet(Course);
  const moduleIds = await idSet(Module);
  const lessonIds = await idSet(Lesson);

  console.log(`[Repair] courses=${courseIds.size} modules=${moduleIds.size} lessons=${lessonIds.size}`);
  console.log(`[Repair] mode: ${FIX ? '⚠️  FIX (will delete)' : 'report only'}\n`);

  const findings = [];

  /** Records the ids in `Model` whose `field` points at something absent from `live`. */
  const scan = async (label, Model, field, live) => {
    const rows = await Model.find({}, { [field]: 1 }).lean();
    const orphans = rows.filter((row) => row[field] && !live.has(String(row[field])));
    findings.push({ label, Model, ids: orphans.map((row) => row._id), field });
    console.log(`[Repair] ${label.padEnd(22)} total=${String(rows.length).padStart(5)}  orphaned=${orphans.length}`);
  };

  // Structural: the course → module → lesson spine.
  await scan('Module (no course)', Module, 'course', courseIds);
  await scan('Lesson (no module)', Lesson, 'module', moduleIds);

  // Everything denormalized with a course id — the collections the cascade sweeps.
  for (const [label, Model] of [
    ['CourseProgress', CourseProgress], ['LessonQuizAttempt', LessonQuizAttempt],
    ['VideoSlot', VideoSlot], ['LessonTranslation', LessonTranslation],
    ['LessonAudio', LessonAudio], ['LessonAudioSegment', LessonAudioSegment],
    ['ChatSession', ChatSession], ['ChatMessage', ChatMessage], ['CourseChunk', CourseChunk],
  ]) {
    await scan(`${label} (no course)`, Model, 'course', courseIds);
  }

  // Rows that name a lesson which is gone, even though their course survives — the
  // shape left by a lesson deleted without its derived artifacts.
  for (const [label, Model] of [
    ['VideoSlot', VideoSlot], ['LessonTranslation', LessonTranslation],
    ['LessonAudio', LessonAudio], ['LessonAudioSegment', LessonAudioSegment],
    ['CourseChunk', CourseChunk],
  ]) {
    await scan(`${label} (no lesson)`, Model, 'lesson', lessonIds);
  }

  // Deduplicated per collection: a video slot whose course AND lesson are both gone
  // is found by two scans but is one document, and a repair tool that overstates the
  // damage is a repair tool nobody trusts the second time.
  const unique = new Map();
  for (const { Model, ids } of findings) {
    const seen = unique.get(Model.modelName) ?? new Set();
    for (const id of ids) seen.add(String(id));
    unique.set(Model.modelName, seen);
  }
  const total = [...unique.values()].reduce((sum, ids) => sum + ids.size, 0);

  if (total === 0) {
    console.log('\n[Repair] ✅ No orphans found.');
    return;
  }

  console.log(`\n[Repair] ${total} orphaned document(s) in total.`);

  if (!FIX) {
    console.log('[Repair] Nothing was changed. Re-run with --fix to delete them.');
    return;
  }

  // One transaction: a repair that is itself interruptible would be a strange thing
  // to fix an interrupted delete with.
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Driven by the deduplicated map rather than the findings list, so a document
      // matched by two scans is deleted once and the counts printed are real.
      const models = new Map(findings.map((finding) => [finding.Model.modelName, finding.Model]));

      for (const [modelName, ids] of unique) {
        if (ids.size === 0) continue;
        const { deletedCount } = await models.get(modelName).deleteMany(
          { _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) } },
          { session }
        );
        console.log(`[Repair] 🗑️  ${modelName}: deleted ${deletedCount}`);
      }
    });
  } finally {
    await session.endSession();
  }

  console.log('\n[Repair] ✅ Done.');
}

main()
  .catch((error) => {
    console.error('[Repair] ❌', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
