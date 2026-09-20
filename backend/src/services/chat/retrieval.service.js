import mongoose from 'mongoose';
import { CourseChunk, Lesson } from '../../models/index.js';
import { embedTexts } from '../ai/aiService.js';
import {
  VECTOR_INDEX_NAME, CHAT_RETRIEVAL_TOP_K, CHAT_CURRENT_LESSON_BOOST, CHAT_RETRIEVAL_MIN_SCORE,
  CHAT_RETRIEVAL_CACHE_TTL_SECONDS,
} from '../../config/env.config.js';
import { cached } from '../cache/cache.js';
import crypto from 'node:crypto';

/**
 * Finding the parts of a course that bear on a question.
 *
 * Retrieval is a best-effort enrichment, never a precondition. Everything here is
 * written so that returning nothing is an ordinary outcome rather than a failure:
 * the tutor always has the current lesson verbatim (see the context builder), so an
 * empty result costs answer quality on cross-lesson questions and nothing else.
 * That matters more than it sounds, because there are two entirely normal states in
 * which this legitimately finds nothing:
 *
 *   - a lesson indexed seconds ago. Atlas Search indexes are eventually consistent,
 *     so a brand-new chunk is not immediately queryable.
 *   - a course whose backfill has not run yet.
 *
 * Neither is an error, and neither should stop a student getting an answer.
 */

/**
 * Errors that mean "this deployment cannot do vector search at all", as opposed to
 * "this query failed". Chiefly a non-Atlas MongoDB, where $vectorSearch is not a
 * pipeline stage — the shape local development takes when it points at a plain
 * mongod instead of a cluster.
 */
const UNSUPPORTED = /\$vectorSearch|Unrecognized pipeline stage|not supported|Atlas|index not found|no such index/i;

// Logged once per process rather than per question: a deployment without vector
// search would otherwise print this on every message a student sends.
let unsupportedWarningShown = false;

/**
 * The chunks of `courseId` most relevant to `query`.
 *
 * @param {object}  params
 * @param {string}  params.courseId   the ONLY scope; see the note on filtering below
 * @param {string} [params.lessonId]  the lesson being read, if any — boosted, not required
 * @param {string}  params.query      the student's question, verbatim
 * @param {number} [params.topK]
 * @returns {Promise<{ chunks: Array, degraded: boolean, reason: string|null }>}
 *
 * `degraded` distinguishes "the course has nothing relevant to say about this" from
 * "retrieval could not run". They look identical from the chunk list and mean very
 * different things to the caller — only the second is worth telling the reader about.
 */
export async function retrieveRelevantChunks({ courseId, lessonId = null, query, topK = CHAT_RETRIEVAL_TOP_K }) {
  if (!query?.trim()) return { chunks: [], degraded: false, reason: null };

  if (CHAT_RETRIEVAL_CACHE_TTL_SECONDS > 0) {
    const key = retrievalCacheKey({ courseId, lessonId, query, topK });

    /*
     * Read-through, and DEGRADED results are never cached.
     *
     * Caching a degradation would turn a momentary outage — an index still
     * building, a failed embedding — into a fixed window during which the tutor
     * answers from the current lesson only, long after the cause has cleared.
     *
     * `cached` never stores null or undefined, so returning undefined on a
     * degraded result is what keeps it out.
     */
    const hit = await cached(key, CHAT_RETRIEVAL_CACHE_TTL_SECONDS, async () => {
      const result = await runRetrieval({ courseId, lessonId, query, topK });
      return result.degraded ? undefined : result;
    });

    if (hit) return hit;

    // Degraded: `cached` computed it, declined to store it, and returned undefined.
    // Run once more so the caller still gets the reason.
    return runRetrieval({ courseId, lessonId, query, topK });
  }

  return runRetrieval({ courseId, lessonId, query, topK });
}

/**
 * The cache key.
 *
 * The question is normalized — trimmed, lowercased, whitespace collapsed — so
 * "What is a client?" and "what is a client?" share an entry. It is then HASHED
 * rather than embedded in the key: a student's question can be two thousand
 * characters, and Redis keys are better short and fixed-width than long and
 * unbounded.
 *
 * lessonId is part of the key because the current-lesson boost reorders results, so
 * the same question asked from two lessons is legitimately two different answers.
 */
function retrievalCacheKey({ courseId, lessonId, query, topK }) {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `retrieval:${courseId}:${lessonId ?? 'course'}:${topK}:${digest}`;
}

/** The uncached path. Everything below here is unchanged by caching. */
async function runRetrieval({ courseId, lessonId, query, topK }) {

  const courseObjectId = new mongoose.Types.ObjectId(String(courseId));

  let queryVector;
  try {
    [queryVector] = await embedTexts([query], { taskType: 'RETRIEVAL_QUERY' });
  } catch (error) {
    // Most often the daily embedding budget, or the provider refusing. The turn can
    // still be answered from the current lesson, so this degrades rather than throws.
    console.warn(`[Retrieval] ⚠️ Could not embed the question: ${error.message}`);
    return { chunks: [], degraded: true, reason: 'question could not be embedded' };
  }

  let hits;
  try {
    hits = await CourseChunk.aggregate([
      {
        // Must be the first stage in the pipeline — Atlas rejects it anywhere else.
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector,

          /*
           * THE AUTHORIZATION BOUNDARY, not an optimization.
           *
           * This filter is the only thing standing between one user's question and
           * another user's course content. It is applied inside the search rather
           * than after it precisely so there is no moment at which foreign chunks
           * exist in this process at all. The caller has already proven the user
           * owns this course; nothing downstream re-checks, so this must never
           * become conditional.
           */
          filter: { course: courseObjectId },

          // Candidates are inspected approximately, then the best `limit` returned.
          // Roughly twenty candidates per wanted result is Atlas's own guidance for
          // recall on a small corpus; a course is small by any measure.
          numCandidates: Math.max(topK * 20, 100),

          // Over-fetch, because the current-lesson boost below reorders these and a
          // chunk that would have placed sixth can legitimately finish third.
          limit: topK * 2,
        },
      },
      { $addFields: { score: { $meta: 'vectorSearchScore' } } },
      {
        $project: {
          content: 1, heading: 1, lesson: 1, chunkIndex: 1,
          blockStart: 1, blockEnd: 1, score: 1,
        },
      },
    ]);
  } catch (error) {
    if (UNSUPPORTED.test(error.message)) {
      if (!unsupportedWarningShown) {
        unsupportedWarningShown = true;
        console.warn(
          `[Retrieval] ⚠️ Vector search is unavailable on this deployment — the tutor ` +
          `will answer from the current lesson only. Run 'npm run search-index' against ` +
          `an Atlas cluster to enable it. (${error.message})`
        );
      }
      return { chunks: [], degraded: true, reason: 'vector search unavailable' };
    }

    console.error(`[Retrieval] ❌ Vector search failed: ${error.message}`);
    return { chunks: [], degraded: true, reason: 'vector search failed' };
  }

  /*
   * Zero raw candidates is not a normal outcome, and has to be distinguished from
   * "nothing relevant".
   *
   * A healthy vector index ALWAYS returns its nearest neighbours, however unrelated
   * the question — asking this course about a cricket match still returns five chunks
   * at around 0.75. So zero candidates against a course that demonstrably has chunks
   * means the search did not really run: an index that is still building, was never
   * created, or is named differently from VECTOR_INDEX_NAME. Atlas reports none of
   * those as an error — it returns an empty result set, which is exactly what a
   * course with nothing to say looks like.
   *
   * Left undetected, that silently turns every answer into a current-lesson-only
   * answer, indefinitely, with nothing in the logs. The extra count runs only in the
   * zero-hit case, so the common path pays nothing for it.
   */
  if (hits.length === 0) {
    const indexed = await CourseChunk.countDocuments({ course: courseObjectId }, { limit: 1 });

    if (indexed > 0) {
      console.warn(
        `[Retrieval] ⚠️ Vector search returned no candidates for course=${courseId} despite ` +
        `indexed chunks — '${VECTOR_INDEX_NAME}' is likely still building or missing. ` +
        `Check with 'npm run search-index'.`
      );
      return { chunks: [], degraded: true, reason: 'vector index unavailable' };
    }

    // No chunks at all: this course has not been indexed yet. Ordinary, and the
    // session-open backfill is what resolves it.
    return { chunks: [], degraded: true, reason: 'course not indexed yet' };
  }

  /*
   * Drop anything below the relevance floor, BEFORE the boost is applied.
   *
   * Filtering on the raw score rather than the boosted rank is the whole point: the
   * boost exists to order chunks that are already relevant, and letting it lift a
   * chunk over the floor would mean the lesson a student happens to be reading could
   * smuggle unrelated content into the prompt.
   *
   * An empty result here is meaningful rather than a failure — it says the course has
   * nothing to say about this question, which is exactly what the context builder
   * needs to know to let the tutor answer from general knowledge and label it.
   */
  const relevant = hits.filter((hit) => hit.score >= CHAT_RETRIEVAL_MIN_SCORE);

  if (relevant.length === 0) {
    // Genuinely not degraded: the search ran, returned candidates, and none of them
    // cleared the floor. The course simply does not cover this — which is a real
    // answer, and the one that lets the tutor say so instead of inventing coverage.
    return { chunks: [], degraded: false, reason: null };
  }

  const ranked = rankWithCurrentLessonBoost(relevant, lessonId).slice(0, topK);

  return { chunks: await withLessonTitles(ranked), degraded: false, reason: null };
}

/**
 * Reorders hits so the lesson being read wins ties.
 *
 * The boost is applied to a separate `rank` field and never to `score`. `score` is
 * what the model's answer gets cited with and what is persisted on the message, so
 * it has to stay the similarity the search actually reported — a stored number that
 * silently includes a UI preference is a number nobody can reason about later.
 */
function rankWithCurrentLessonBoost(hits, lessonId) {
  const current = lessonId ? String(lessonId) : null;

  return hits
    .map((hit) => ({
      ...hit,
      fromCurrentLesson: current !== null && String(hit.lesson) === current,
      rank: current !== null && String(hit.lesson) === current
        ? hit.score * CHAT_CURRENT_LESSON_BOOST
        : hit.score,
    }))
    .sort((a, b) => b.rank - a.rank);
}

/**
 * Attaches the lesson title and module id each chunk needs to be cited.
 *
 * Read from the Lesson documents rather than denormalized onto the chunk: a lesson
 * can be renamed, and a citation that still shows the title the lesson had when it
 * was indexed is a citation pointing at something the reader cannot find. The module
 * id is here because a link back into the course needs course, module AND lesson.
 *
 * One query for all of them, not one per chunk.
 */
async function withLessonTitles(chunks) {
  const lessonIds = [...new Set(chunks.map((chunk) => String(chunk.lesson)))];

  const lessons = await Lesson.find({ _id: { $in: lessonIds } })
    .select('title module')
    .lean();

  const byId = new Map(lessons.map((lesson) => [String(lesson._id), lesson]));

  return chunks.map((chunk) => {
    const lesson = byId.get(String(chunk.lesson));
    return {
      ...chunk,
      // A lesson deleted between indexing and now. The chunk is about to be swept by
      // the next reindex; until then it is still usable context, just uncitable.
      lessonTitle: lesson?.title ?? null,
      moduleId: lesson?.module ?? null,
    };
  });
}
