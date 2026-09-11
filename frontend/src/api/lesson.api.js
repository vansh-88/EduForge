import apiClient from './client';

// Lessons are addressed through their module — lessonId alone is not enough.
const lessonPath = (courseId, moduleId, lessonId) =>
  `/v1/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`;

const idempotent = () => ({ headers: { 'Idempotency-Key': crypto.randomUUID() } });

/**
 * Reads a lesson. Never triggers generation for the requested lesson — if its
 * status isn't READY, `content` is empty and the caller should start generation
 * and watch the SSE stream.
 *
 * Returns { lesson, quiz, navigation }, where navigation.previous/next are
 * either null or { moduleId, lessonId }.
 */
export const getLesson = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.get(lessonPath(courseId, moduleId, lessonId));
  return response.data.data;
};

/**
 * Slot state only: { slots: [{ slotId, status, video? }], enrichment }.
 *
 * Used to refresh a resolving video without refetching the whole lesson, which
 * would replace content the reader is partway through.
 */
export const getVideoSlots = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.get(`${lessonPath(courseId, moduleId, lessonId)}/video-slots`);
  return response.data.data;
};

export const generateLesson = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.post(
    lessonPath(courseId, moduleId, lessonId),
    {},
    idempotent()
  );

  // Flat body: { success, message, lessonId, status }
  return response.data;
};

/** `selected` is 1-based to match the option numbering the backend grades against. */
export const submitAnswer = async (courseId, moduleId, lessonId, questionId, selected) => {
  const response = await apiClient.post(
    `${lessonPath(courseId, moduleId, lessonId)}/questions/${questionId}/answer`,
    { selected }
  );

  return response.data.data;
};

/**
 * Asks for a Hinglish rendering of this lesson, generating it if there isn't one.
 *
 * Returns the flat body `{ success, message, lessonId, language, status, ... }`.
 * A 200 carries `content` and means it was already cached; a 202 means a job was
 * started (or one was already running) and the answer arrives over SSE.
 *
 * Idempotent like `generateLesson` — this spends a real AI call, so repeated
 * clicks must not become repeated jobs.
 */
export const requestTranslation = async (courseId, moduleId, lessonId, language = 'hinglish') => {
  const response = await apiClient.post(
    `${lessonPath(courseId, moduleId, lessonId)}/translations`,
    { language },
    idempotent()
  );

  return response.data;
};

/**
 * Reads a translation: `{ lessonId, language, status, content, generation }`.
 *
 * `content` is null unless status is READY. `NOT_REQUESTED` means no one has
 * asked for this language yet; `STALE` means one exists but was derived from a
 * version of the lesson that has since been regenerated.
 *
 * Side-effect free — unlike the POST it can never start a job.
 */
export const getTranslation = async (courseId, moduleId, lessonId, language = 'hinglish') => {
  const response = await apiClient.get(
    `${lessonPath(courseId, moduleId, lessonId)}/translations/${language}`
  );

  return response.data.data;
};

/**
 * Asks for spoken audio of this lesson, generating it if there isn't any.
 *
 * A 200 means it was already made; a 202 means a job is running. Both bodies
 * carry `segments`, because audio is usable before it is complete — a reader who
 * reloads mid-generation gets back every section that is already playable rather
 * than starting from silence.
 *
 * Idempotent: a lesson's worth of speech is the most expensive thing this app can
 * be asked to make by accident.
 */
export const requestAudio = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.post(
    `${lessonPath(courseId, moduleId, lessonId)}/audio`,
    {},
    idempotent()
  );

  return response.data;
};

/**
 * Reads a lesson's audio: `{ lessonId, status, segments, generation }`.
 *
 * Segments come back at every status with `audioUrl` set only on READY ones, so
 * the player can show how many sections are coming and which it is waiting on.
 * `NOT_REQUESTED` means nobody has asked yet; `STALE` means audio exists but the
 * lesson has been regenerated since.
 *
 * Side-effect free, so it is safe to re-read on reconnect.
 */
export const getAudio = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.get(`${lessonPath(courseId, moduleId, lessonId)}/audio`);
  return response.data.data;
};

export const completeLesson = async (courseId, moduleId, lessonId) => {
  const response = await apiClient.post(`${lessonPath(courseId, moduleId, lessonId)}/complete`);
  return response.data.data;
};
