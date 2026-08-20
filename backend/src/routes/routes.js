import { Router } from 'express';
import { healthRouter } from './health.routes.js';
import {courseRouter} from './course.routes.js';


export const router = Router();

router.use(healthRouter);
router.use('/v1/course', courseRouter);