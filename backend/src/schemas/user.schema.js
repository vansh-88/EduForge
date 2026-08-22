import { z } from 'zod';

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    picture: z.url().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });