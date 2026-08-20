export function buildCoursePrompt(topic) {
  return `
You are an expert curriculum designer.
Your task is to design a comprehensive, highly structured course outline for the following topic:
"${topic}"

REQUIREMENTS & CONSTRAINTS:
1. Course Details:
   - Provide a clear, engaging, concise and specific "title".
   - Provide a concise (2-4 sentences) "description" (what the student will learn and why it matters).
   - Define between 1 and 10 actionable "learningGoals".
   - Include up to 10 relevant "tags".

2. Modules (Strictly 3 to 6 modules):
   - Break the course down into a logical progression of modules.
   - Each module must have a clear, concise and specific "title".
   - Each module must have a specific overarching "goal".

3. Lessons (Strictly 3 to 5 lessons per module):
   - For each module, outline the lessons required to achieve the module's goal.
   - Each lesson should teach one coherent concept.
   - For each lesson, provide:
     a. "title": a clear, concise, and specific lesson title.
     b. "objectives": between 1 and 8 specific, measurable learning objectives describing what the student should be able to understand, explain, apply, or accomplish after completing the lesson.
   - Do NOT generate lesson content, explanations, quizzes, code blocks, videos, or text blocks.
   - Only generate the lesson title and its learning objectives.
   - Objectives must be specific to the individual lesson and must not simply repeat the module goal.
   - Objectives should follow the lesson's role in the overall learning progression.
   - Ensure every objective is directly supported by the lesson title and contributes to the module goal.
   - Ensure lesson titles and objectives form a logical, step-by-step learning progression.
   - The final lesson of a module should help consolidate or apply the concepts introduced in that module when appropriate.
   - Do not repeat the same concept across multiple lessons unless repetition is pedagogically necessary.

Tone: Professional, educational, and encouraging.
Target Audience: Beginners to intermediates seeking structured knowledge.

Follow the JSON schema exactly. Ensure all length bounds and array limits are respected.
`;
}