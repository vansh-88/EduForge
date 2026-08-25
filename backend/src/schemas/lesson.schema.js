import { z } from 'zod';
import mongoose from 'mongoose';

//--------------------------lesson input schema------------------------------
export const generateLessonRequestSchema = z.object({
  lessonId: z
    .string({
      required_error: 'lessonId is required',
      invalid_type_error: 'lessonId must be a string',
    })
    .trim()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: 'lessonId must be a valid MongoDB ObjectId',
    }),
});



//--------------------------mcq input schema------------------------------
// Body of a single MCQ answer submission. `selected` is 1-based to match
export const submitAnswerSchema = z.object({
  selected: z
    .number({
      required_error: 'selected is required',
      invalid_type_error: 'selected must be a number',
    })
    .int('selected must be an integer')
    .min(1, 'selected must be at least 1')
    .max(4, 'selected must be at most 4'),
});



//----------------------------Building Blocks---------------------------------
// 1. Heading Block
export const headingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),              //1 : course, 2 : module, 3 : lesson
  text: z.string().trim().min(1, 'Heading text cannot be empty').max(300),
});

// 2. Paragraph Block
export const paragraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  text: z.string().trim().min(1, 'Paragraph text cannot be empty').max(5000),
});

// 3. Code Block
export const codeBlockSchema = z.object({
  type: z.literal('code'),
  language: z.string().trim().min(1).default('plaintext'),
  text: z.string().min(1, 'Code snippet cannot be empty'),
  caption: z.string().trim().max(200).optional(),
});

// 4. Video / Media Embed Block
export const videoBlockSchema = z.object({
  type: z.literal('video'),
  query: z.string().trim().min(1, 'video query cannot be empty'),
  caption: z.string().trim().max(300).optional(),
});

// 5. MCQ Block
export const mcqBlockSchema = z
  .object({
    type: z.literal('mcq'),
    question: z.string().trim().min(5, 'Question must be at least 5 characters'),
    options: z
      .array(z.string().trim().min(1, 'Option cannot be empty'))
      .length(4, 'MCQ must provide exactly 4 options'),
    answer: z
      .number()
      .int('Answer index must be an integer')
      .min(1, 'Answer index must be a positive integer')
      .max(4, 'Answer index must be between 1 and 4'),
    explanation: z
      .string()
      .trim()
      .min(1, 'Explanation is required for answer validation'),
  })
  .refine((data) => data.answer >= 1 && data.answer <= data.options.length, {
    message: 'Answer index is out of bounds for the provided options array',
    path: ['answer'],
  });



// Discriminated Union across all block types
export const lessonBlockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  paragraphBlockSchema,
  codeBlockSchema,
  videoBlockSchema,
  mcqBlockSchema,
]);




// ----------------------------Output Schemas for Lesson Content-------------------------------

export const lessonOutputSchema = z
  .object({
    content: z
      .array(lessonBlockSchema)
      .min(1, 'Lesson content must contain at least 1 block')
      .max(50, 'Lesson content cannot exceed 50 blocks'),
  })
  .superRefine((data, ctx) => {
    // Count how many blocks have type 'mcq'
    const mcqCount = data.content.filter((block) => block.type === 'mcq').length;

    if (mcqCount < 4 || mcqCount > 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Lesson content must contain between 4 and 5 MCQs, but received ${mcqCount}`,
        path: ['content'],
      });
    }
  });