import { Router } from 'express';
import { generateLesson, getLesson, getLessonVideoSlots, submitLessonAnswer, completeLesson } from '../controllers/lesson.controller.js';
import { streamLessonGenerationEvents } from '../controllers/lessonEvents.controller.js';
import { requestTranslation, getTranslation } from '../controllers/translation.controller.js';
import { streamLessonTranslationEvents } from '../controllers/lessonTranslationEvents.controller.js';
import { requestAudio, getAudio } from '../controllers/audio.controller.js';
import { streamLessonAudioEvents } from '../controllers/lessonAudioEvents.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { submitAnswerSchema, requestTranslationSchema } from '../schemas/index.js';
import { generationRateLimiter } from '../middlewares/rateLimit.middleware.js';

export const lessonRouter = Router({ mergeParams: true });


lessonRouter.get('/:lessonId', getLesson);
// Spends a real AI call, so it shares the per-user generation limiter.
lessonRouter.post('/:lessonId', generationRateLimiter, generateLesson);

lessonRouter.post('/:lessonId/questions/:questionId/answer', validate(submitAnswerSchema), submitLessonAnswer);
lessonRouter.post('/:lessonId/complete', completeLesson);

// Slot state only. Lets a resolving video update its own block without
// refetching the lesson under a reader — and, unlike GET /:lessonId, triggers
// no lookahead generation or failed-slot retry as a side effect.
lessonRouter.get('/:lessonId/video-slots', getLessonVideoSlots);

// Lesson translations: a lazy, cached artifact derived from the English lesson,
// which stays the source of truth. Like generation, POST spends a real AI call and
// so shares the per-user generation limiter; GET never starts one.
lessonRouter.post('/:lessonId/translations', generationRateLimiter, validate(requestTranslationSchema), requestTranslation);
lessonRouter.get('/:lessonId/translations/:language', getTranslation);

// Its own stream rather than the lesson's: a translation is requested long after
// the lesson is READY, by which point the lesson's generation stream has already
// reached its terminal state and closed.
lessonRouter.get('/:lessonId/translations/:language/events', streamLessonTranslationEvents);

// Lesson audio: the same lazy, cached, hash-keyed artifact pattern as
// translations. POST spends real TTS calls and so shares the generation limiter;
// GET never starts one, so a player may re-read it on reconnect.
lessonRouter.post('/:lessonId/audio', generationRateLimiter, requestAudio);
lessonRouter.get('/:lessonId/audio', getAudio);
lessonRouter.get('/:lessonId/audio/events', streamLessonAudioEvents);

// Authenticated by the requireAuth/attachUser pair on the parent /v1/courses mount.
// The Authorization header is the only accepted credential, so the client must use a fetch-based SSE library rather than the browser's native EventSource.
lessonRouter.get('/:lessonId/generation/events', streamLessonGenerationEvents);