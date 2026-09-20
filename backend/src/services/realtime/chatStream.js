const HEARTBEAT_MS = 15000;

/**
 * Drives one chat SSE response.
 *
 * Deliberately NOT streamGeneration. That driver exists to bridge Redis Pub/Sub
 * from the worker process to a reader: it subscribes first, reads a MongoDB
 * snapshot, replays what arrived in between, and holds a dedicated Redis
 * subscriber open for the life of the stream. None of that applies here. The
 * producer is this request, in this process — there is no channel to subscribe
 * to, no snapshot to reconcile against, and no subscriber to clean up.
 *
 * What is reused is the wire format, so the frontend's existing stream client
 * parses these events with no special case: `event: <type>` followed by a JSON
 * `data:` line, the same header set including the nginx buffering opt-out, and a
 * heartbeat comment to keep intermediaries from closing an idle connection.
 *
 * Assumes authorization already happened. By the time this is called the headers
 * are about to be committed and a 4xx is no longer possible — the same rule the
 * generation streams follow, and the reason every SSE controller authorizes
 * before it writes a byte.
 */
export function openChatStream(req, res) {
  let heartbeat = null;
  let closed = false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
  });

  // Committed immediately so the client's onopen fires now rather than whenever the
  // first token happens to arrive. Without it a slow first token is indistinguishable
  // from a connection that never opened.
  res.flushHeaders?.();

  /**
   * A token is small and frequent, and the heartbeat exists for the gap BEFORE the
   * first one — retrieval and prompt assembly take a moment, and an idle proxy can
   * close a connection in that window.
   */
  heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  const send = (type, payload = {}) => {
    if (closed) return;
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  // Safe to call repeatedly: a terminal event and a client disconnect both reach it.
  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    res.end();
  };

  /**
   * Fires when the client goes away — navigated, closed the tab, lost the network.
   *
   * The caller registers a handler here so it can abort the provider call and
   * persist whatever text it has. `closed` is set first so nothing tries to write
   * to a socket that is already gone.
   */
  const onDisconnect = (handler) => {
    req.on('close', () => {
      if (closed) return; // our own close(), not the client's
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      handler();
    });
  };

  return { send, close, onDisconnect, get closed() { return closed; } };
}
