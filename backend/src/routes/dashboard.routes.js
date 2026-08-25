import { Router } from 'express';
import { getDashboard } from '../controllers/dashboard.controller.js';

export const dashboardRouter = Router();

// Always the signed-in user's own dashboard — there is no id in the path, so there is
// nothing to authorize beyond being authenticated.
dashboardRouter.get('/', getDashboard);
