import mongoose from 'mongoose';
import { Course, Module, Lesson } from '../../models/index.js';
import { courseOutputSchema } from '../../schemas/index.js';
import { generateStructured } from '../../services/ai/aiService.js';
import { buildCoursePrompt } from '../../services/ai/prompts/coursePrompt.js';


// Executes the database transaction to persist the AI-generated course structure.
// Separating this from the AI call ensures the DB lock is held for the shortest time possible.

async function persistGeneratedCourse(session, { courseId, userId, aiResponse }) {
  // Re-fetch the course inside the transaction with a lock
  const currentCourse = await Course.findOne({ _id: courseId, creator: userId }).session(session);

  if (!currentCourse) {
    throw new Error(`Course ${courseId} disappeared before persistence.`);
  }

  // Idempotency: If another completed, do nothing.
  if (currentCourse.status === 'READY') {
    return;
  }

  currentCourse.title = aiResponse.title;
  currentCourse.description = aiResponse.description;
  currentCourse.tags = aiResponse.tags ?? [];
  currentCourse.learningGoals = aiResponse.learningGoals ?? [];
  currentCourse.modules = [];
  currentCourse.lastError = null;

  for (let moduleIndex = 0; moduleIndex < aiResponse.modules.length; moduleIndex++) {
    const moduleData = aiResponse.modules[moduleIndex];

    const moduleDoc = new Module({
      title: moduleData.title,
      goal: moduleData.goal,
      order: moduleIndex,
      course: currentCourse._id,
      lessons: [],
    });

    for (let lessonIndex = 0; lessonIndex < moduleData.lessons.length; lessonIndex++) {
      const lessonData = moduleData.lessons[lessonIndex];

      const lessonDoc = new Lesson({
        title: lessonData.title,
        order: lessonIndex,
        objectives: lessonData.objectives ?? [],
        content: [],
        status: 'PENDING', // Content will be lazily generated later
        module: moduleDoc._id,
      });

      await lessonDoc.save({ session });
      moduleDoc.lessons.push(lessonDoc._id);
    }

    await moduleDoc.save({ session });
    currentCourse.modules.push(moduleDoc._id);
  }

  currentCourse.status = 'READY';
  await currentCourse.save({ session });
}


/**
 * Main worker logic: Orchestrates the AI call and the database transaction for worker
 * @param {Object} params
 * @param {string} params.courseId
 * @param {string} params.userId
 * @param {string} params.topic
 * @param {import('bullmq').Job} [params.job] - Optional BullMQ job for progress tracking
 */

export async function runAiCourseGeneration({ courseId, userId, topic, job, generationId }) {
  
  // 1. ATOMIC CLAIM: Only one worker can flip from 'GENERATING' to 'PROCESSING'
  const claimedCourse = await Course.findOneAndUpdate(
    {
      _id: courseId,
      creator: userId,
      status: 'GENERATING',
    },
    {
      $set: {
        status: 'PROCESSING',
      },
    },
    { returnDocument: 'after' }
  );

  //If null, another worker instance already claimed it or it was completed/failed
  if (!claimedCourse) {
    console.log(`[Worker] Job skipped: Course ${courseId} & ${generationId} is already claimed, completed, or missing.`);
    return;
  }

  try{
    // 2. AI Generation Phase
    await job?.updateProgress({ stage: 'GENERATING_OUTLINE' });

    const prompt = buildCoursePrompt(topic);
  
    //expense ai call
    const aiResponse = await generateStructured( prompt, courseOutputSchema);

    // 3. Persistence Phase
    await job?.updateProgress({ stage: 'PERSISTING_COURSE' });

    const session = await mongoose.startSession();

    try {
      // withTransaction automatically handles commit and rollback
      await session.withTransaction(async () => {
        await persistGeneratedCourse(session, { courseId, userId, aiResponse });
      });
    }
    finally {
      await session.endSession();
    }

    await job?.updateProgress({ stage: 'COMPLETED' });

    return { courseId, status: 'READY' };

  }
  catch (error) {
    // Evaluate if BullMQ has remaining retries configured
    const maxAttempts = job?.opts?.attempts || 3;
    const currentAttempt = (job?.attemptsMade || 0) + 1;
    const isFinalAttempt = currentAttempt >= maxAttempts;

    // 4. Update Course state based on retry exhaustion
    await Course.updateOne(
      { _id: courseId },
      {
        $set: {
          status: isFinalAttempt ? 'FAILED' : 'GENERATING',
          lastError: `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}`,
        },
      }
    );

    // Re-throw so BullMQ triggers backoff/retry or transitions job to 'failed' state
    throw error;
  }
  
  
}