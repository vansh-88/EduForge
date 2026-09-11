import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TTS_MODEL, TTS_VOICE } from '../../config/env.config.js';
import {z} from 'zod';
import { sanitizeForGemini } from '../../utils/gemini/sanitiseJson.js';
import { pcmToWav, parsePcmMimeType, pcmDurationSeconds } from '../../utils/audio/wav.js';
import { classifyProviderError } from './providerError.js';

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
        let response;
        try {
            response = await gemini.models.generateContent({
                model: GEMINI_MODEL,
                contents: prompt,
                config: {
                responseMimeType: 'application/json',
                responseSchema: sanitisedJsonSchema, // Use the sanitized JSON schema for Gemini
                temperature: 0.7,     // Add a bit of creativity for course generation, ranges(0-2), randomness, 0.7 is a good balance between creativity and coherence, default is 1.0, lower values make the output more deterministic and focused, higher values make it more random and creative.
                },
            });
        } catch (error) {
            // Same quota exposure as the speech path — lesson generation and
            // translation share one free-tier allowance.
            throw classifyProviderError(error);
        }
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

    },


    /**
     * Speaks `text`, returning WAV bytes.
     *
     * A sibling of generateStructured rather than a reuse of it: the response is
     * audio, not JSON, so there is no schema to validate and no text to parse.
     *
     * Gemini's TTS models return HEADERLESS PCM — the mimeType says
     * `audio/L16;codec=pcm;rate=24000` and the payload is raw samples. Nothing
     * plays that, so the header is added here rather than left for every caller
     * to remember.
     *
     * @param {string} text
     * @param {{ voice?: string }} options
     * @returns {Promise<{ audio: Buffer, mimeType: string, durationSeconds: number }>}
     */
    async synthesizeSpeech(text, { voice = TTS_VOICE } = {}) {

        let response;
        try {
            response = await gemini.models.generateContent({
                model: GEMINI_TTS_MODEL,
                contents: text,
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
                    },
                },
            });
        } catch (error) {
            // A 429 arrives as a JSON blob on the message. Classified here so the
            // worker can tell "wait a minute" from "not until tomorrow" — retrying
            // the latter just burns the retry budget in a few seconds.
            throw classifyProviderError(error);
        }

        const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;

        if (!inline?.data) {
            // Usually a safety block or a rate limit; either way there is no audio
            // and the caller must retry rather than persist an empty segment.
            const reason = response.candidates?.[0]?.finishReason ?? 'unknown';
            throw new Error(`Gemini returned no audio (finishReason: ${reason})`);
        }

        const pcm = Buffer.from(inline.data, 'base64');
        const format = parsePcmMimeType(inline.mimeType);

        return {
            audio: pcmToWav(pcm, format),
            mimeType: 'audio/wav',
            durationSeconds: pcmDurationSeconds(pcm, format),
        };
    },


}


