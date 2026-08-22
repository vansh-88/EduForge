import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
import { updateUserSchema } from '../schemas/index.js';
import { getMe, updateMe } from '../controllers/user.controller.js';

export const userRouter = Router();


userRouter.get('/me', getMe);
userRouter.patch('/me', validate(updateUserSchema), updateMe);