import { Router } from 'express';
import { healthRouter } from './health.routes.js';
import {courseRouter} from './course.routes.js';
import { userRouter } from './user.routes.js';
import { requireAuth, attachUser } from '../middlewares/auth.middleware.js';


export const router = Router();

router.use(healthRouter);
router.use('/v1/courses', requireAuth, attachUser, courseRouter);
router.use('/v1/users', requireAuth, attachUser, userRouter);