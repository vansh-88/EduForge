import mongoose from 'mongoose';
import { EMBEDDING_DIMENSIONS, VECTOR_INDEX_NAME } from '../config/env.config.js';

/**
 * A retrievable piece of a lesson, and its embedding.
 *
 * Derived data, never a source of truth: the lesson's block array remains
 * authoritative and these rows are rebuilt from it. That is the whole reason
 * `lessonContentHash` exists — a chunk set whose hash no longer matches the
 * lesson it came from was derived from content that has since changed.
 *
 * Chunks are deliberately smaller than a lesson. One embedding for a whole
 * lesson averages every idea in it into a single point, which retrieves
 * everything weakly and nothing well; a chunk carries one idea, and its
 * heading breadcrumb is prepended to `content` so it still makes sense when it
 * arrives in a prompt on its own.
 */
const courseChunkSchema = new mongoose.Schema(
  {
    // The retrieval boundary. Every $vectorSearch filters on this, and it is an
    // authorization control rather than an optimization: without it a query could
    // reach chunks of a course the caller does not own.
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },

    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },

    chunkIndex: {
      type: Number,
      required: true,
    },

    // The nearest enclosing heading, kept as its own field so a citation can name
    // the section rather than only the lesson.
    heading: {
      type: String,
      default: null,
    },

    // The text that was embedded, breadcrumb included — so what is retrieved is
    // exactly what was indexed, rather than something reassembled at read time.
    content: {
      type: String,
      required: true,
    },

    // Which blocks this came from. Used to drop a retrieved chunk that the current
    // lesson's verbatim context already covers, so the model is not handed the same
    // passage twice.
    blockStart: {
      type: Number,
      required: true,
    },
    blockEnd: {
      type: Number,
      required: true,
    },

    // The hash of the WHOLE lesson's content, not of this chunk — see
    // utils/contentHash.js. Chunk boundaries move when a lesson is regenerated, so
    // a per-chunk hash could not answer the only question that matters here: is
    // this entire chunk set still derived from the lesson as it stands?
    lessonContentHash: {
      type: String,
      required: true,
    },

    embedding: {
      type: [Number],
      required: true,
    },

    // Recorded so a model or dimension change is detectable in the data rather
    // than inferred from when a row was written. A mismatch means the row predates
    // the current index and must be rebuilt.
    embeddingModel: {
      type: String,
      required: true,
    },
    dims: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

// Rebuilding a lesson's chunks replaces them wholesale, so this is what stops a
// partially-failed reindex from leaving two chunks at the same position.
courseChunkSchema.index({ lesson: 1, chunkIndex: 1 }, { unique: true });

// "Is this lesson already indexed at its current content?" — the idempotency
// check every indexing job starts with.
courseChunkSchema.index({ lesson: 1, lessonContentHash: 1 });

// Cascade on course delete.
courseChunkSchema.index({ course: 1 });

/**
 * The Atlas Vector Search index.
 *
 * Declared here rather than clicked together in the Atlas UI so it is reviewable
 * code and reproducible across environments. It is NOT created at boot —
 * `autoSearchIndex` stays off, because an index build takes minutes and must not
 * sit in the startup path. Create it once per environment with
 * `npm run search-index`.
 *
 * `numDimensions` must match EMBEDDING_DIMENSIONS exactly; Atlas rejects a vector
 * of any other length on write. Changing the dimension is a migration — drop the
 * index, reindex every course, rebuild — not a configuration change.
 *
 * `course` and `lesson` must be declared as filter fields: $vectorSearch can only
 * filter on paths the index knows about, and the course filter is what keeps one
 * user's question from reaching another user's course.
 */
courseChunkSchema.searchIndex({
  name: VECTOR_INDEX_NAME,
  type: 'vectorSearch',
  definition: {
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: EMBEDDING_DIMENSIONS,
        // Cosine, matching how the vectors are stored: embeddings are
        // L2-normalized on write, so direction is the whole signal and magnitude
        // carries nothing.
        similarity: 'cosine',
      },
      { type: 'filter', path: 'course' },
      { type: 'filter', path: 'lesson' },
    ],
  },
});

export const CourseChunk = mongoose.model('CourseChunk', courseChunkSchema);
