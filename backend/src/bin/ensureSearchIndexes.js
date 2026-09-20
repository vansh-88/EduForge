import mongoose from 'mongoose';
import { connectDB } from '../config/db.config.js';
import { CourseChunk } from '../models/index.js';
import { VECTOR_INDEX_NAME, EMBEDDING_DIMENSIONS } from '../config/env.config.js';

/**
 * Creates the Atlas Search indexes declared on the schemas.
 *
 * A separate command rather than part of boot. Mongoose can do this on
 * connection via `autoSearchIndex`, but an Atlas index build takes minutes and a
 * server that cannot answer a request until it finishes is a server that fails
 * its health check on every deploy. Run this once per environment, and again
 * only when an index definition changes.
 *
 *   npm run search-index
 *
 * Idempotent: an index that already exists is reported and left alone. It does
 * NOT reconcile a definition that has since changed — Atlas has no "update index"
 * that can reshape a vector field, so a changed numDimensions means dropping the
 * index, reindexing every course, and running this again. That is deliberate
 * friction around a migration, not an oversight.
 *
 * Fails loudly on a non-Atlas deployment. Search indexes are an Atlas feature;
 * against a plain mongod this command cannot do its job, and reporting success
 * would only move the failure to the first question a student asks.
 */

const NOT_ATLAS = /Atlas|not supported|Unrecognized|CommandNotSupported|no such command/i;

/** Through the driver collection rather than the Mongoose wrappers, which hand
 *  back cursors whose implicit session has already ended. */
const listIndexes = () => CourseChunk.collection.listSearchIndexes().toArray();

async function ensure() {
  console.log(`[SearchIndex] Ensuring '${VECTOR_INDEX_NAME}' on ${CourseChunk.collection.collectionName} (${EMBEDDING_DIMENSIONS} dimensions)`);

  // Atlas refuses to index a namespace that does not exist, and on a fresh
  // deployment nothing has written a chunk yet. Mongoose creates collections
  // lazily on first write, so it is created up front here rather than making the
  // first indexing run a prerequisite for the index that run depends on.
  try {
    await CourseChunk.createCollection();
  } catch (error) {
    // NamespaceExists — the ordinary case on every run after the first.
    if (error.codeName !== 'NamespaceExists' && !/already exists/i.test(error.message)) throw error;
  }

  let indexes;
  try {
    indexes = await listIndexes();
  } catch (error) {
    if (NOT_ATLAS.test(error.message)) {
      throw new Error(
        'This MongoDB deployment does not support Atlas Search indexes, so the Course ' +
        `Tutor cannot retrieve anything. Point MONGO_URI at an Atlas cluster. ` +
        `Underlying error: ${error.message}`
      );
    }
    throw error;
  }

  // Checked rather than relying on a duplicate-key error: createSearchIndexes
  // reports the name whether or not it did anything, so creating blind would
  // print "created" on every run and the output would stop meaning anything.
  if (indexes.some((index) => index.name === VECTOR_INDEX_NAME)) {
    console.log('[SearchIndex] Already exists — not recreating.');
  } else {
    const created = await CourseChunk.createSearchIndexes();
    console.log(`[SearchIndex] ✅ Created: ${created.join(', ') || '(none declared)'}`);
    indexes = await listIndexes();
  }

  // An index exists long before it can answer a query. Report the real state
  // rather than letting the first student question discover it is still building.
  for (const index of indexes) {
    console.log(`[SearchIndex] ${index.queryable ? '✅' : '⏳'} ${index.name}: ${index.status}${index.queryable ? ' (queryable)' : ''}`);
  }

  if (!indexes.some((index) => index.name === VECTOR_INDEX_NAME && index.queryable)) {
    console.log('[SearchIndex] ⏳ Not queryable yet. An index build usually takes a minute or two; re-run to check.');
  }
}

async function main() {
  await connectDB();
  try {
    await ensure();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('[SearchIndex] ❌', error.message);
  process.exit(1);
});
