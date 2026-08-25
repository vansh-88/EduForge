import { Router } from 'express';
import { generateLesson, getLesson, submitLessonAnswer, completeLesson } from '../controllers/lesson.controller.js';
import { streamLessonGenerationEvents } from '../controllers/lessonEvents.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { submitAnswerSchema } from '../schemas/index.js';

export const lessonRouter = Router({ mergeParams: true });


lessonRouter.get('/:lessonId', getLesson);
lessonRouter.post('/:lessonId', generateLesson);

lessonRouter.post('/:lessonId/questions/:questionId/answer', validate(submitAnswerSchema), submitLessonAnswer);
lessonRouter.post('/:lessonId/complete', completeLesson);

// Authenticated by the requireAuth/attachUser pair on the parent /v1/courses mount.
// The Authorization header is the only accepted credential, so the client must use a fetch-based SSE library rather than the browser's native EventSource.
lessonRouter.get('/:lessonId/generation/events', streamLessonGenerationEvents);