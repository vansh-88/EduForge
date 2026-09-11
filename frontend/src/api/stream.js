import { fetchEventSource } from '@microsoft/fetch-event-source';
import { getToken } from './authToken';

// Same base as apiClient — the backend mounts everything under /api, so callers
// here write '/v1/...' exactly as they do for axios.
const BASE_URL = `${import.meta.env.VITE_API_BASE_URL}/api`;

/**
 * Thrown when the server answered but the answer will never improve — a bad
 * token, someone else's course, a deleted one. `fetchEventSource` retries every
 * error it is given except the one thrown from `onopen`, so this is what stops
 * it from hammering an endpoint that has already made up its mind.
 */
class FatalStreamError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FatalStreamError';
    this.status = status;
  }
}

const FATAL_MESSAGES = {
  401: 'Your session expired. Please sign in again.',
  403: 'You do not have access to this.',
  404: 'This no longer exists.',
};

/**
 * Opens a generation stream.
 *
 * Deliberately bypasses `apiClient`: axios in the browser buffers the whole
 * response, so it cannot read an event stream incrementally. The token comes
 * from the same `authToken` bridge the axios interceptor uses, so both clients
 * stay on one source of credentials.
 *
 * `handlers`:
 *   onEvent(event)    every parsed event, including the opening snapshot
 *   onTerminal(event) once, for the event after which the server closes
 *   onFatal(error)    the stream stopped for good and will not reconnect
 *
 * Returns an abort function. Calling it is the only way a stream ends early —
 * it is what unmount and terminal-event cleanup both go through.
 */
function openStream(path, { onEvent, onTerminal, onFatal, terminalTypes }) {
  const controller = new AbortController();

  // A stream ends once. Both routes to that — a terminal event type, and the
  // server closing the connection — go through here so a terminal event
  // followed by the close it causes does not fire the callback twice.
  let terminalFired = false;

  const fireTerminal = (event) => {
    if (terminalFired) return;
    terminalFired = true;
    onTerminal?.(event);
  };

  const run = async () => {
    let token;
    try {
      token = await getToken();
    } catch {
      // Auth0 hasn't finished loading. Callers sit behind ProtectedRoute, so
      // rather than failing we let the request go out unauthenticated and let
      // the 401 path below produce a real message.
      token = null;
    }

    await fetchEventSource(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'text/event-stream',
      },

      // A generation can outlast the user's attention. Without this the library
      // closes the stream when the tab is hidden and the user comes back to a
      // progress bar frozen wherever it was.
      openWhenHidden: true,

      async onopen(response) {
        if (response.ok) return;

        // 4xx will never fix itself; 5xx and network failures might, so only
        // the former is fatal. Everything else falls through to the library's
        // own exponential retry.
        if (response.status >= 400 && response.status < 500) {
          throw new FatalStreamError(
            response.status,
            FATAL_MESSAGES[response.status] ?? `Request failed (${response.status})`
          );
        }

        throw new Error(`Stream failed with ${response.status}`);
      },

      onmessage(message) {
        // Heartbeats arrive as bare comments and never reach here. Anything
        // else without data is noise.
        if (!message.data) return;

        let event;
        try {
          event = JSON.parse(message.data);
        } catch {
          // One malformed frame must not tear down a stream that is otherwise
          // healthy — the next snapshot re-syncs us anyway.
          return;
        }

        onEvent?.(event);

        if (terminalTypes.includes(event.type)) {
          fireTerminal(event);
          // The server closes on terminal events too, but aborting here means
          // we never race its close with a reconnect attempt.
          controller.abort();
        }
      },

      onerror(error) {
        if (error instanceof FatalStreamError) {
          onFatal?.(error);
          throw error; // rethrow: this is what stops the retry loop
        }

        // Transient. Returning undefined lets the library back off and retry;
        // the snapshot it receives on reconnect restores any missed progress,
        // which is why a blip never needs to surface to the user.
      },

      onclose() {
        // The server closed the connection. Returning without throwing prevents
        // a reconnect.
        //
        // A close with no terminal event before it is itself the signal that
        // nothing more is coming: the server evaluates terminality against
        // MongoDB when the stream opens, so a generation that finished between
        // the caller's fetch and this subscription is answered with a snapshot
        // and an immediate close, and no completed-event is ever published.
        // Treating the close as terminal handles that precisely — the caller
        // does not have to infer it from a status, which stopped being reliable
        // once a lesson could be READY while its video slots were still
        // resolving.
        fireTerminal({ type: 'stream_closed' });
      },
    }).catch(() => {
      // Abort and fatal both land here. Both were already handled above; this
      // only keeps an unhandled rejection out of the console.
    });
  };

  run();

  return () => controller.abort();
}

// Terminal sets mirror the backend exactly (see generationStream.js). Every
// stream under a course also watches the course-deleted fan-out, which is why
// 'course_deleted' terminates both kinds.
const COURSE_TERMINAL = [
  'course_generation_completed',
  'course_generation_failed',
  'course_deleted',
];

// Note what is absent: 'lesson_generation_completed'. Content becoming readable
// no longer ends the stream, because video slots resolve afterwards and publish
// onto the same channel. 'lesson_enrichment_completed' — sent once the last slot
// settles, or immediately when a lesson has none — is what closes it.
const LESSON_TERMINAL = [
  'lesson_enrichment_completed',
  'lesson_generation_failed',
  'course_deleted',
];

// A translation has no sibling resources reporting in after it, so unlike the
// lesson set this one really does end at 'completed'.
const TRANSLATION_TERMINAL = [
  'lesson_translation_completed',
  'lesson_translation_failed',
  'course_deleted',
];

// Note what is absent: 'audio_segment_ready'. A section becoming playable is the
// start of listening, not the end of generating — closing there would drop every
// remaining section, which is the opposite of what progressive playback needs.
const AUDIO_TERMINAL = ['audio_completed', 'audio_failed', 'course_deleted'];

export const streamCourseGeneration = (courseId, handlers) =>
  openStream(`/v1/courses/${courseId}/generation/events`, {
    ...handlers,
    terminalTypes: COURSE_TERMINAL,
  });

export const streamLessonGeneration = (courseId, moduleId, lessonId, handlers) =>
  openStream(
    `/v1/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/generation/events`,
    { ...handlers, terminalTypes: LESSON_TERMINAL }
  );

/**
 * Its own stream rather than the lesson's. A translation is requested long after
 * the lesson is READY, by which point the lesson's generation stream has reached
 * its terminal state and closed.
 */
export const streamLessonTranslation = (courseId, moduleId, lessonId, language, handlers) =>
  openStream(
    `/v1/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/translations/${language}/events`,
    { ...handlers, terminalTypes: TRANSLATION_TERMINAL }
  );

/** Carries each section's URL as it becomes playable, plus the job's own lifecycle. */
export const streamLessonAudio = (courseId, moduleId, lessonId, handlers) =>
  openStream(
    `/v1/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/audio/events`,
    { ...handlers, terminalTypes: AUDIO_TERMINAL }
  );
