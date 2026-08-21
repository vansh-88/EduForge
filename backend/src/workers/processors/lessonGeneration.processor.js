import mongoose from 'mongoose';
import { Lesson, Module, Course } from '../../models/index.js';
import { lessonOutputSchema, generateLessonRequestSchema } from '../../schemas/index.js';
import { generateStructured } from '../../services/ai/aiService.js';
import { buildLessonPrompt } from '../../services/ai/prompts/lessonPrompt.js';
import { buildLessonContext } from '../../services/ai/context/lessonContext.js';

async function persistGeneratedLesson(session, { lessonId, aiResponse }) {
  const currentLesson = await Lesson.findOne({ _id: lessonId, status: 'PROCESSING' }).session(session);

  if (!currentLesson) {
    // Not in PROCESSING (e.g. already READY from a prior successful attempt) — nothing to do.
    return;
  }

  currentLesson.content = aiResponse.content;
  currentLesson.status = 'READY';
  currentLesson.lastError = null;
  await currentLesson.save({ session });
}

export async function runAiLessonGeneration({ lessonId, courseId, userId, generationId, job }) {
  // 0. Validate payload shape (no need, just an extra safety check)
  generateLessonRequestSchema.parse({ lessonId });

  // 1. ATOMIC CLAIM
  const claimedLesson = await Lesson.findOneAndUpdate(
    { _id: lessonId, status: 'GENERATING' },
    { $set: { status: 'PROCESSING' } },
    { returnDocument: 'after' }
  );

  if (!claimedLesson) {
    console.log(`[LessonWorker] Job skipped: Lesson ${lessonId} already claimed, completed, or missing (generation=${generationId}).`);
    return;
  }

  try {
    // 2. Load context
    await job?.updateProgress({ stage: 'LOADING_CONTEXT' });

    const context = await buildLessonContext( courseId, lessonId, userId );

    // 3. AI Generation
    await job?.updateProgress({ stage: 'GENERATING_CONTENT' });

    const prompt = buildLessonPrompt({ course: context.courseDoc, module: context.moduleDoc, lesson: context.lessonDoc });
    const aiResponse = await generateStructured(prompt, lessonOutputSchema);

    // 4. Persistence
    await job?.updateProgress({ stage: 'PERSISTING_LESSON' });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await persistGeneratedLesson(session, { lessonId, aiResponse });
      });
    } finally {
      await session.endSession();
    }

    await job?.updateProgress({ stage: 'COMPLETED' });
    return { lessonId, status: 'READY' };

  } catch (error) {
    const maxAttempts = job?.opts?.attempts || 3;
    const currentAttempt = (job?.attemptsMade || 0) + 1;
    const isFinalAttempt = currentAttempt >= maxAttempts;

    await Lesson.updateOne(
      { _id: lessonId },
      {
        $set: {
          status: isFinalAttempt ? 'FAILED' : 'GENERATING',
          lastError: `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}`,
        },
      }
    );

    throw error;
  }
}