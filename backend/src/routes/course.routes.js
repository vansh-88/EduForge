import { Router } from 'express';
import {generateCourse, listCourses, getCourseById, getModuleById, retryCourseGeneration} from '../controllers/course.controller.js';
import { validate} from '../middlewares/validate.middleware.js';
import { generateCourseRequestSchema } from '../schemas/index.js';
import { lessonRouter } from './lesson.routes.js';


export const courseRouter = Router();

courseRouter.use('/:courseId/lessons', lessonRouter);

courseRouter.post('/generate', validate(generateCourseRequestSchema), generateCourse);
courseRouter.post('/:courseId/retry', retryCourseGeneration);

courseRouter.get('/', listCourses);
courseRouter.get('/:courseId', getCourseById);
courseRouter.get('/:courseId/modules/:moduleId', getModuleById)

