import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GEMINI_MODEL } from '../../config/env.js';
import {z} from 'zod';
import { sanitizeForGemini } from '../../utils/gemini/sanitiseJson.js';

// Initialize the Google Gen AI client
export const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

export const geminiProvider = {


    /**
     * @param {string} prompt
     * @param {import('zod').ZodSchema} schema
     * @returns {JSON} parsedData
     */
    async generateStructured(prompt, schema) {

        // 1. Convert Zod → JSON Schema (OpenAPI 3 target is best for Gemini's responseSchema)
        const jsonSchema = z.toJSONSchema(schema, { 
            target: 'openapi-3.0'
        });
        const sanitisedJsonSchema = sanitizeForGemini(jsonSchema);
        // console.log('Converted Zod to JSON:', JSON.stringify(jsonSchema));


        // 2. Call Gemini
        const response = await gemini.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
            responseMimeType: 'application/json',
            responseSchema: sanitisedJsonSchema, // Use the sanitized JSON schema for Gemini
            temperature: 0.7,     // Add a bit of creativity for course generation, ranges(0-2), randomness, 0.7 is a good balance between creativity and coherence, default is 1.0, lower values make the output more deterministic and focused, higher values make it more random and creative.
            },
        });
        // console.log('Gemini response:', response);


        // 3. Get response text
        const responseText = response.text;

        if (!responseText) {
            throw new Error('Gemini returned an empty response.');
        }


        // 4. JSON.parse()
        let parsedData;
        try {
            parsedData = JSON.parse(responseText);
            // console.log('Parsed Gemini output as JSON:', parsedData);
        } catch (error) {
            console.error('Failed to parse Gemini output as JSON:', responseText);
            throw new Error('AI output was not valid JSON');
        }


        // 5. Return parsed data
        return parsedData;

    }


}


