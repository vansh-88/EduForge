import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GEMINI_MODEL } from '../../config/env.js';

// Initialize the Google Gen AI client
export const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

export const geminiProvider = {


    /**
     * Generates structured data using Gemini, constrained and validated by a Zod schema.
     * 
     * @param {string} prompt - The instructions and context for the AI.
     * @param {import('zod').ZodSchema} schema - The Zod schema to enforce and validate against.
     * @returns {Promise<any>} The strongly-typed, validated object.
     */
    
    async generateStructured(prompt, jsonSchema) {

        // 1. Call Gemini
        const response = await gemini.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
            responseMimeType: 'application/json',
            responseSchema: jsonSchema,
            temperature: 0.7,     // Add a bit of creativity for course generation, ranges(0-2), randomness, 0.7 is a good balance between creativity and coherence, default is 1.0, lower values make the output more deterministic and focused, higher values make it more random and creative.
            },
        });
        // console.log('Gemini response:', response);

        // 2. Get response text
        const responseText = response.text;

        if (!responseText) {
            throw new Error('Gemini returned an empty response.');
        }

        // 3. JSON.parse()
        let parsedData;
        try {
            parsedData = JSON.parse(responseText);
            // console.log('Parsed Gemini output as JSON:', parsedData);
        } catch (error) {
            console.error('Failed to parse Gemini output as JSON:', responseText);
            throw new Error('AI output was not valid JSON');
        }

        // 4. Return parsed data
        return parsedData;

    }


}


