import { WORKER_WAKE_URL, WORKER_WAKE_MIN_INTERVAL_MS } from '../../config/env.config.js';

/**
 * Waking the worker process, from the API process.
 *
 * On free-tier hosting the worker is a web service that sleeps after a stretch
 * without inbound HTTP traffic, and it is the process that runs the outbox
 * publisher. A sleeping worker therefore stalls work before it is ever queued —
 * the outbox row is committed, and then nothing reads it.
 *
 * This is deliberately fire-and-forget. Waking the worker is an optimisation on
 * top of a durable outbox, never a correctness requirement: if the ping fails,
 * is dropped, or the worker is already awake and ignores it, the events are
 * still in MongoDB and are still published the moment the publisher next runs.
 * So a failed ping must never surface to the caller, and must never delay the
 * response to a user whose request is already safely committed.
 */

let lastPingAt = 0;

export function pingWorker() {
  // Unset outside the deployment this exists for — local development, or a
  // single process running both roles, where there is nothing to wake.
  if (!WORKER_WAKE_URL) return;

  const now = Date.now();

  if (now - lastPingAt < WORKER_WAKE_MIN_INTERVAL_MS) return;

  // Stamped before the request, not after it. A cold start holds the connection
  // open for the best part of a minute, and every event written in that window
  // would otherwise fire a ping of its own at a service that is already booting.
  lastPingAt = now;

  // Generous, because the slow case IS the case worth waiting for: a request
  // that takes fifty seconds is one that successfully woke a sleeping worker.
  fetch(WORKER_WAKE_URL, { signal: AbortSignal.timeout(90_000) }).catch(() => {});
}
