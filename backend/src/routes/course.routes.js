import { Router } from 'express';
import {generateCourse, listCourses, getCourseById} from '../controllers/course.controller.js';
import { validate} from '../middlewares/validate.middleware.js';
import { generateCourseRequestSchema } from '../schemas/index.js';


export const courseRouter = Router();


courseRouter.post('/generate', validate(generateCourseRequestSchema), generateCourse);
courseRouter.get('/', listCourses);
courseRouter.get('/:courseId', getCourseById);

