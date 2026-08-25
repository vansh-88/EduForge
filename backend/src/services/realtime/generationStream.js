import { subscribeChannels, toGenerationEvent } from './generationEvents.js';

const HEARTBEAT_MS = 15000;

/**
 * Drives one SSE generation stream. Shared by the course and lesson endpoints so the
 * ordering and cleanup rules live in exactly one place.
 *
 * Callers supply:
 *   kind          'lesson' | 'course'
 *   id            the aggregate id (snapshot key, and the snapshot event's name)
 *   channels      every channel to watch — the aggregate's own generation channel
 *                 plus the course-deleted fan-out, so one publish can close it
 *   loadSnapshot  async () => ({ status, stage, progress, attempt, maxAttempts, lastError }) | null
 *                 read AFTER subscribing, so nothing published in between is lost
 *   isTerminal    (mongoStatus) => boolean
 *   terminalTypes event types that end the stream
 *
 * Assumes authorization already happened — by the time this runs, headers are about
 * to be committed and a 4xx is no longer possible.
 */
export async function streamGeneration(req, res, { kind, id, channels, loadSnapshot, isTerminal, terminalTypes }) {
  let heartbeat = null;
  let snapshotSent = false;
  let closed = false;
  let buffered = [];

  const sendEvent = (event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Safe to call repeatedly: a terminal event and the client disconnect both fire it.
  const cleanup = () => {
    if (closed) return;
    closed = true;

    if (heartbeat) clearInterval(heartbeat);
    Promise.resolve(subscription?.close()).catch(() => {});
    res.end();
  };

  const emit = (event) => {
    if (closed) return;
    sendEvent(event);
    if (terminalTypes.includes(event.type)) cleanup();
  };

  // 1. Subscribe FIRST so nothing published between here and the snapshot read is
  // lost. Live events are buffered until the snapshot has gone out, otherwise they
  // would overtake it — or worse, a terminal event would end the stream before the
  // snapshot could be written.
  const subscription = subscribeChannels(channels, (event) => {
    if (!snapshotSent) {
      buffered.push(event);
      return;
    }
    emit(event);
  });

  await subscription.subscribed;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
  });

  req.on('close', cleanup);

  // 2. Now read the MongoDB snapshot — the authoritative current state.
  const snapshot = await loadSnapshot();

  if (!snapshot) return cleanup();

  sendEvent(
    toGenerationEvent({
      type: `${kind}_generation_snapshot`,
      status: snapshot.status,
      stage: snapshot.stage,
      progress: snapshot.progress,
      attempt: snapshot.attempts,
      maxAttempts: snapshot.maxAttempts,
      lastError: snapshot.lastError,
    })
  );

  snapshotSent = true;

  // Already terminal — nothing further will ever be published for this aggregate.
  if (isTerminal(snapshot.status)) return cleanup();

  // 3. Flush anything that arrived while the snapshot was being read.
  const pending = buffered;
  buffered = [];
  for (const event of pending) emit(event);

  if (closed) return;

  heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
}
