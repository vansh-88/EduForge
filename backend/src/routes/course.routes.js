import { Router } from 'express';
import {generateCourse, listCourses, getCourseById, retryCourseGeneration, deleteCourse} from '../controllers/course.controller.js';
import { streamCourseGenerationEvents } from '../controllers/courseEvents.controller.js';
import { validate} from '../middlewares/validate.middleware.js';
import { generateCourseRequestSchema, listCoursesQuerySchema } from '../schemas/index.js';
import { lessonRouter } from './lesson.routes.js';


export const courseRouter = Router();

courseRouter.use('/:courseId/modules/:moduleId/lessons', lessonRouter);

courseRouter.post('/generate', validate(generateCourseRequestSchema), generateCourse);
courseRouter.post('/:courseId/retry', retryCourseGeneration);

courseRouter.get('/', validate(listCoursesQuerySchema, 'query'), listCourses);
courseRouter.get('/:courseId', getCourseById);

// Authenticated by the requireAuth/attachUser pair on the parent /v1/courses mount.
courseRouter.get('/:courseId/generation/events', streamCourseGenerationEvents);

courseRouter.delete('/:courseId', deleteCourse);
