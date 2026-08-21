import { Router } from 'express';
import { generateLesson } from '../controllers/lesson.controller.js';

export const lessonRouter = Router({ mergeParams: true });

lessonRouter.post('/:lessonId/generate', generateLesson);