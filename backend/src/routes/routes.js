import { Router } from 'express';
import { healthRouter } from './health.routes.js';
import {courseRouter} from './course.routes.js';
import { userRouter } from './user.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { requireAuth, attachUser } from '../middlewares/auth.middleware.js';
import { readRateLimiter } from '../middlewares/rateLimit.middleware.js';


export const router = Router();

router.use(healthRouter);

// The baseline every authenticated route sits behind. Applied after attachUser so
// it keys on the account rather than the IP, and generous enough that it catches a
// runaway client rather than a busy reader. Tighter tiers layer on top of it at the
// routes that actually cost something.
router.use('/v1/courses', requireAuth, attachUser, readRateLimiter, courseRouter);
router.use('/v1/users', requireAuth, attachUser, readRateLimiter, userRouter);
router.use('/v1/dashboard', requireAuth, attachUser, readRateLimiter, dashboardRouter);