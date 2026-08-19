import { provider } from './index.js';

export async function generateStructured(prompt, schema) {

    // 2. call AIProvider
    const parsedData = await provider.generateStructured(prompt, schema);

    // 3. schema.Safeparse()
    const validatedResult = schema.safeParse(parsedData);
    // console.log('Validated Gemini output against Zod schema:', validatedResult);

    if(!validatedResult.success) {
        throw validatedResult.error;
    }

    // 6. Return validated result
    return validatedResult.data;
}