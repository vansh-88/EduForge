import { z } from 'zod';

// `picture` is deliberately NOT updatable here. It used to accept any URL, which let a
// user point their avatar at arbitrary third-party content served under the app's UI.
// Pictures now go through the Cloudinary endpoints, which are the only writers of
// `picture` and `picturePublicId`.
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });
