import { Router } from 'express';
import { generateLesson, getLesson } from '../controllers/lesson.controller.js';
import { streamLessonGenerationEvents } from '../controllers/lessonEvents.controller.js';

export const lessonRouter = Router({ mergeParams: true });


lessonRouter.get('/:lessonId', getLesson);
lessonRouter.post('/:lessonId', generateLesson);

// Authenticated by the requireAuth/attachUser pair on the parent /v1/courses mount.
// The Authorization header is the only accepted credential, so the client must use a fetch-based SSE library rather than the browser's native EventSource.
lessonRouter.get('/:lessonId/generation/events', streamLessonGenerationEvents);