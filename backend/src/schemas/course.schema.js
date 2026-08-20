import { z } from 'zod';

//-------------input schema for generating a course.-----------------
export const generateCourseRequestSchema = z.object({
  topic: z
    .string({
      required_error: 'Topic is required',
      invalid_type_error: 'Topic must be a string',
    })
    .trim()
    .min(3, 'Topic must be at least 3 characters long')
    .max(300, 'Topic must not exceed 300 characters'),
});




//-------------output schema for generating a module.-----------------

// Lesson Schema (Lazy generation: only title is required initially)
export const generatedLessonSchema = z.object({
  title: z
    .string({ required_error: 'Lesson title is required' })
    .trim()
    .min(1, 'Lesson title must be at least 1 character')
    .max(300, 'Lesson title must not exceed 300 characters'),

  objectives: z
    .array(
      z
      .string()
      .trim()
      .min(1, 'Objective cannot be empty')
      .max(300, 'Objective must not exceed 300 characters')
    )
    .min(1, 'Lesson must have at least 1 objective')
    .max(8, 'Lesson cannot exceed 8 objectives'),
});

// Module Schema (1 goal, 3-5 lessons)
export const generatedModuleSchema = z.object({
  title: z
    .string({ required_error: 'Module title is required' })
    .trim()
    .min(1, 'Module title must be at least 1 character')
    .max(300, 'Module title must not exceed 300 characters'),
  goal: z
    .string({ required_error: 'Module goal is required' })
    .trim()
    .min(1, 'Module goal cannot be empty')
    .max(500, 'Module goal must not exceed 500 characters'),
  lessons: z
    .array(generatedLessonSchema)
    .min(3, 'Each module must contain at least 3 lessons')
    .max(5, 'Each module must contain at most 5 lessons'),
});

// Course Output Schema
export const courseOutputSchema = z.object({
  title: z
    .string({ required_error: 'Course title is required' })
    .trim()
    .min(1, 'Course title must be at least 1 character')
    .max(300, 'Course title must not exceed 300 characters'),
  description: z
    .string({ required_error: 'Course description is required' })
    .trim()
    .min(1, 'Course description must be at least 1 character')
    .max(2000, 'Course description must not exceed 2000 characters'),
  learningGoals: z
    .array(
      z.string().trim().min(1, 'Learning goal cannot be empty').max(300)
    )
    .min(1, 'Course must have at least 1 learning goal')
    .max(10, 'Course cannot exceed 10 learning goals'),
  tags: z
    .array(
      z.string().trim().min(1, 'Tag cannot be empty').max(50)
    )
    .min(0)
    .max(10, 'Course cannot exceed 10 tags')
    .default([]),
  modules: z
    .array(generatedModuleSchema)
    .min(3, 'Course must have at least 3 modules')
    .max(6, 'Course cannot exceed 6 modules'),
});