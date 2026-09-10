import mongoose from 'mongoose';
import { redisConnection } from '../config/redis.config.js';

/**
 * The worker process reporting its own health to the API process.
 *
 * `queue.getWorkersCount()` is not enough on its own: it proves a worker is
 * attached to Redis, nothing more. A worker that has lost MongoDB still answers
 * that check while being completely unable to do any work — which is exactly the
 * state a readiness probe exists to catch, and exactly the state that was
 * observed in practice (a transient DNS failure knocked out Atlas while
 * /api/ready happily reported the worker healthy).
 *
 * So the worker publishes what only it can know — whether its own MongoDB
 * connection is live — and the API reads that instead of inferring it.
 *
 * Not configurable: the interval is an internal detail with no deployment
 * reason to tune, and the TTL must stay a multiple of it.
 */
const HEARTBEAT_KEY = 'eduforge:worker:heartbeat';
const INTERVAL_MS = 5000;

// Three missed beats before the key disappears — long enough to ride out a GC
// pause or a slow event loop, short enough that a dead worker is noticed fast.
const TTL_SECONDS = Math.ceil((INTERVAL_MS * 3) / 1000);

let timer = null;

async function beat() {
  try {
    const payload = JSON.stringify({
      at: Date.now(),
      pid: process.pid,
      mongo: mongoose.connection.readyState === 1,
    });

    await redisConnection.set(HEARTBEAT_KEY, payload, 'EX', TTL_SECONDS);
  } catch {
    // If Redis is unreachable the key expires on its own and the API reports the
    // worker as down — which is the truth. Never let a failed heartbeat take the
    // worker process with it.
  }
}

export function startWorkerHeartbeat() {
  if (timer) return;

  beat();
  timer = setInterval(beat, INTERVAL_MS);

  // A heartbeat must never be the reason the process stays alive.
  timer.unref?.();
}

export async function stopWorkerHeartbeat() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // Drop the key on a clean shutdown so the API reports the worker as gone
  // immediately, rather than after the TTL.
  try {
    await redisConnection.del(HEARTBEAT_KEY);
  } catch {
    // Expiry is the fallback.
  }
}

/**
 * The worker's self-reported health, as seen from the API process.
 * Returns null when no worker has reported recently.
 */
export async function readWorkerHeartbeat() {
  let raw;
  try {
    raw = await redisConnection.get(HEARTBEAT_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const beat = JSON.parse(raw);
    return { ...beat, ageMs: Date.now() - beat.at };
  } catch {
    return null;
  }
}
