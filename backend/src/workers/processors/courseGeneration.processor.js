import mongoose from 'mongoose';
import { Course, Module, Lesson } from '../../models/index.js';
import { courseOutputSchema } from '../../schemas/index.js';
import { generateStructured } from '../../services/ai/aiService.js';
import { buildCoursePrompt } from '../../services/ai/prompts/coursePrompt.js';
import { publishGenerationEvent } from '../../services/realtime/generationEvents.js';


async function setStageAndPublish(courseId, state, { stage, progress, attempt, maxAttempts }) {
  // Track locally too, so the retry/failure events can report where generation got to
  // instead of blanking the client's progress bar.
  state.stage = stage;
  state.progress = progress;

  await Course.updateOne({ _id: courseId }, { $set: { stage, progress } });
  await publishGenerationEvent('course', courseId, {
    type: 'course_generation_progress',
    status: 'generating',
    stage,
    progress,
    attempt,
    maxAttempts,
  });
}


// Executes the database transaction to persist the AI-generated course structure.
// Separating this from the AI call ensures the DB lock is held for the shortest time possible.

async function persistGeneratedCourse(session, { courseId, userId, generationId, aiResponse }) {
  // Re-fetch inside the transaction, scoped to OUR claim. If a newer cycle took over
  // (or it already completed), this job must not overwrite its work.
  const currentCourse = await Course.findOne({
    _id: courseId,
    creator: userId,
    status: 'PROCESSING',
    generationId,
  }).session(session);

  // Report that nothing was written so the caller does not announce a completion.
  if (!currentCourse) {
    return false;
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

  currentCourse.moduleCount = currentCourse.modules.length;
  currentCourse.lessonCount = aiResponse.modules.reduce(
    (total, module) => total + module.lessons.length,
    0
  );
  currentCourse.completedAt = new Date();
  currentCourse.stage = 'completed';
  currentCourse.progress = 100;
  currentCourse.status = 'READY';
  await currentCourse.save({ session });

  return true;
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
  const currentAttempt = (job?.attemptsMade || 0) + 1;
  const maxAttempts = job?.opts?.attempts;

  // 1. ATOMIC CLAIM — GENERATING (first attempt) or RETRYING (a prior attempt failed).
  // A PROCESSING doc stamped with OUR generationId is this job's own stranded claim
  // from a killed worker: reclaim it, otherwise the course stays PROCESSING forever
  // and the user can never retry it. Another cycle's PROCESSING still bounces off.
  const claimedCourse = await Course.findOneAndUpdate(
    {
      _id: courseId,
      creator: userId,
      $or: [
        { status: { $in: ['GENERATING', 'RETRYING'] } },
        { status: 'PROCESSING', generationId },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        generationId,
        attempts: currentAttempt,
        maxAttempts,
        stage: 'generating_outline',
        progress: 20,
      },
    },
    { returnDocument: 'after' }
  );

  //If null, another generation cycle owns it or it was completed/failed
  if (!claimedCourse) {
    console.log(`[Worker] Job skipped: Course ${courseId} & ${generationId} is already claimed, completed, or missing.`);
    return;
  }

  const state = { stage: 'generating_outline', progress: 20 };

  await publishGenerationEvent('course', courseId, {
    type: currentAttempt === 1 ? 'course_generation_started' : 'course_generation_progress',
    status: 'generating',
    stage: state.stage,
    progress: state.progress,
    attempt: currentAttempt,
    maxAttempts,
  });

  try{
    // 2. AI Generation Phase — difficulty comes off the claimed document, so a retry
    // automatically uses the stored value and there is one source of truth.
    const prompt = buildCoursePrompt({ topic, difficulty: claimedCourse.difficulty });

    //expense ai call
    const aiResponse = await generateStructured( prompt, courseOutputSchema);

    // 3. Persistence Phase
    await setStageAndPublish(courseId, state, { stage: 'saving', progress: 80, attempt: currentAttempt, maxAttempts });

    let persisted = false;
    const session = await mongoose.startSession();

    try {
      // withTransaction automatically handles commit and rollback
      await session.withTransaction(async () => {
        persisted = await persistGeneratedCourse(session, { courseId, userId, generationId, aiResponse });
      });
    }
    finally {
      await session.endSession();
    }

    // Nothing was written (a newer cycle owns the course) — announcing completion here
    // would tell the client to fetch an outline this job never produced.
    if (!persisted) {
      console.log(`[CourseWorker] Nothing persisted for course ${courseId} (generation=${generationId}) — superseded.`);
      return { courseId, status: 'SKIPPED' };
    }

    await publishGenerationEvent('course', courseId, {
      type: 'course_generation_completed',
      status: 'ready',
      stage: 'completed',
      progress: 100,
      attempt: currentAttempt,
      maxAttempts,
    });

    return { courseId, status: 'READY' };

  }
  catch (error) {
    const isFinalAttempt = currentAttempt >= maxAttempts;
    const lastError = `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}`;

    // Guarded by our own claim: without this, a throw that happens AFTER the course
    // was already committed READY would demote it and trigger a regeneration that
    // destroys its modules and lessons.
    await Course.updateOne(
      { _id: courseId, status: 'PROCESSING', generationId },
      {
        $set: {
          status: isFinalAttempt ? 'FAILED' : 'RETRYING',
          lastError,
          completedAt: null,
        },
      }
    );

    await publishGenerationEvent('course', courseId, {
      type: isFinalAttempt ? 'course_generation_failed' : 'course_generation_retrying',
      status: isFinalAttempt ? 'failed' : 'retrying',
      stage: state.stage,
      progress: state.progress,
      attempt: currentAttempt,
      maxAttempts,
      lastError,
    });

    // Re-throw so BullMQ triggers backoff/retry or transitions job to 'failed' state
    throw error;
  }


}