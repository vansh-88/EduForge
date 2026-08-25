import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
import { updateUserSchema } from '../schemas/index.js';
import {
  getMe, updateMe, getMyStats, deleteMe,
  getPictureUploadSignature, confirmPictureUpload, deleteMyPicture,
} from '../controllers/user.controller.js';

export const userRouter = Router();


userRouter.get('/me', getMe);
userRouter.patch('/me', validate(updateUserSchema), updateMe);
userRouter.delete('/me', deleteMe);

userRouter.get('/me/stats', getMyStats);

// Signed direct upload: the browser sends the image straight to Cloudinary, so no
// image bytes ever pass through this API.
userRouter.post('/me/picture/signature', getPictureUploadSignature);
userRouter.post('/me/picture/confirm', confirmPictureUpload);
userRouter.delete('/me/picture', deleteMyPicture);
