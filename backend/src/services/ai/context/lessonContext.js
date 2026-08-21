import { Lesson } from '../../../models/index.js';


export async function buildLessonContext(courseId, lessonId, userId) {

  // 1. Fetch only the necessary fields for the prompt and for validation
  const lesson = await Lesson.findById(lessonId)
    .select('title order objectives module')
    .populate({
      path: 'module',
      select: 'title goal order course lessons',
      populate: [
        {
          path: 'course',
          select: 'title description learningGoals creator',
        },
        {
          path: 'lessons',
          select: 'title order',
          options: { sort: { order: 1 } }, // Guarantees chronological order for the prompt
        }
      ],
    });

  if (!lesson || !lesson.module || !lesson.module.course) {
    throw new Error('Incomplete hierarchy: Lesson, Module, or Course not found.');
  }

  // 2. Validate relationships and ownership
  if (lesson.module.course._id.toString() !== courseId.toString()) {
    throw new Error('Course mismatch: The requested lesson does not belong to the provided courseId.');
  }

  if (lesson.module.course.creator.toString() !== userId.toString()) {
    throw new Error('Unauthorized: User does not own this course.');
  }


  // 3. Return strictly the fields expected by buildLessonPrompt
  return {
    courseDoc: {
      title: lesson.module.course.title,
      description: lesson.module.course.description,
      learningGoals: lesson.module.course.learningGoals,
    },
    moduleDoc: {
      title: lesson.module.title,
      goal: lesson.module.goal,
      order: lesson.module.order,
      lessons: lesson.module.lessons, // Populated directly from the Module schema
    },
    lessonDoc: {
      title: lesson.title,
      order: lesson.order,
      objectives: lesson.objectives,
    },
  };
}