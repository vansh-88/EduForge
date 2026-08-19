import {z} from 'zod';
import { provider } from './index.js';

export async function generateStructured(prompt, schema) {

    // 1. Convert Zod → JSON Schema (OpenAPI 3 target is best for Gemini's responseSchema)
    const jsonSchema = z.toJSONSchema(schema, { 
        target: 'openapi-3.0'
    });
    // console.log('Converted Zod to JSON:', JSON.stringify(jsonSchema));

    // 2. call AIProvider
    const parsedData = await provider.generateStructured(prompt, jsonSchema);

    // 3. schema.Safeparse()
    const validatedResult = schema.safeParse(parsedData);
    // console.log('Validated Gemini output against Zod schema:', validatedResult);

    if(!validatedResult.success) {
        throw validatedResult.error;
    }

    // 6. Return validated result
    return validatedResult.data;
}