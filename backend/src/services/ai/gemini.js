import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TTS_MODEL, TTS_VOICE, GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, CHAT_MODEL, CHAT_MAX_OUTPUT_TOKENS } from '../../config/env.config.js';
import {z} from 'zod';
import { sanitizeForGemini } from '../../utils/gemini/sanitiseJson.js';
import { pcmToWav, parsePcmMimeType, pcmDurationSeconds } from '../../utils/audio/wav.js';
import { classifyProviderError, ProviderQuotaError } from './providerError.js';
import { assertCanSpend, recordSpend, markExhausted } from './quota.js';

// Initialize the Google Gen AI client
export const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

/**
 * Scales a vector to unit length.
 *
 * Gemini only returns pre-normalized embeddings at its native 3072 dimensions.
 * Anything shorter is that vector truncated, which is a valid embedding but no
 * longer unit length — and an un-normalized vector makes magnitude, which carries
 * no meaning here, leak into similarity scores. Cheaper to fix once on write than
 * to account for on every query.
 *
 * A zero vector cannot be normalized and is returned unchanged; the caller's
 * length check has already established it is the right shape, and a chunk that
 * embeds to zero would have failed upstream.
 */
function normalize(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return values;
  return values.map((value) => value / magnitude);
}

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


        // 2. Call Gemini.
        //
        // Guarded on both sides: refuse locally when we already know the budget is
        // gone, and trip the breaker when the provider tells us it is. Without the
        // first, every queued job makes a round trip to be refused; without the
        // second, we never learn.
        await assertCanSpend(GEMINI_MODEL);

        let response;
        try {
            await recordSpend(GEMINI_MODEL);
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
            const classified = classifyProviderError(error);
            if (classified instanceof ProviderQuotaError && classified.daily) {
                // Deliberately NOT classified.retryAfterSeconds: on a daily quota that
                // field carries the per-minute retry hint (tens of seconds), and using
                // it would reopen the circuit while the day's budget is still gone.
                await markExhausted(GEMINI_MODEL);
            }
            throw classified;
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

        await assertCanSpend(GEMINI_TTS_MODEL);

        let response;
        try {
            await recordSpend(GEMINI_TTS_MODEL);
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
            const classified = classifyProviderError(error);
            if (classified instanceof ProviderQuotaError && classified.daily) {
                // Authoritative: the provider has spoken, so stop guessing from the
                // counter and refuse locally until the quota resets.
                //
                // No TTL argument on purpose — retryAfterSeconds is the per-minute
                // hint even on a daily rejection, so passing it would reopen the
                // circuit in under a minute with the day's budget still spent.
                await markExhausted(GEMINI_TTS_MODEL);
            }
            throw classified;
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


    /**
     * A conversational turn, returned whole.
     *
     * The fourth provider method, and the first that is neither structured nor
     * single-shot: it takes a message history and a system instruction rather than
     * one prompt string. generateStructured cannot serve this — it forces a JSON
     * response schema, and a tutor's answer is prose.
     *
     * The system instruction goes through config.systemInstruction rather than being
     * concatenated into the first turn. That is what keeps the rules the model must
     * follow in a different channel from the course content it reasons over, which
     * matters because that content is generated text and may say anything.
     *
     * @param {{ systemInstruction: string, contents: Array, maxOutputTokens?: number }} params
     * @returns {Promise<{ text: string, inputTokens: number|null, outputTokens: number|null, finishReason: string|null }>}
     */
    async chat({ systemInstruction, contents, maxOutputTokens = CHAT_MAX_OUTPUT_TOKENS }) {

        await assertCanSpend(CHAT_MODEL);

        let response;
        try {
            await recordSpend(CHAT_MODEL);
            response = await gemini.models.generateContent({
                model: CHAT_MODEL,
                contents,
                config: {
                    systemInstruction,
                    maxOutputTokens,
                    // Lower than course generation's 0.7. Explaining a fixed body of
                    // material rewards consistency, not invention — two students
                    // asking the same question about the same lesson should not get
                    // materially different explanations.
                    temperature: 0.4,
                },
            });
        } catch (error) {
            const classified = classifyProviderError(error);
            if (classified instanceof ProviderQuotaError && classified.daily) {
                await markExhausted(CHAT_MODEL);
            }
            throw classified;
        }

        const text = response.text;

        if (!text?.trim()) {
            // Usually a safety block or an immediate token-limit stop. There is no
            // answer to persist, and the caller must report a failure rather than
            // save an empty assistant turn into the conversation.
            const reason = response.candidates?.[0]?.finishReason ?? 'unknown';
            throw new Error(`The model returned no answer (finishReason: ${reason})`);
        }

        const usage = response.usageMetadata ?? {};

        return {
            text,
            inputTokens: usage.promptTokenCount ?? null,
            outputTokens: usage.candidatesTokenCount ?? null,
            finishReason: response.candidates?.[0]?.finishReason ?? null,
        };
    },


    /**
     * Embeds one or more strings, returning a vector per input in the same order.
     *
     * A third sibling of generateStructured and synthesizeSpeech: same quota
     * guards, same error classification, different response shape. There is no
     * schema to validate and no text to parse — the provider either returned
     * vectors of the expected length or it did not.
     *
     * Batched deliberately. A lesson is five to a dozen chunks, and sending them
     * as one request makes indexing a whole lesson cost ONE call against the daily
     * budget rather than a dozen — which is the difference between indexing a back
     * catalogue and exhausting a free-tier key on it.
     *
     * `taskType` is not decoration. Gemini embeds a document and the question that
     * should retrieve it into deliberately different regions, so indexing with
     * RETRIEVAL_DOCUMENT and querying with RETRIEVAL_QUERY measurably beats using
     * one type for both.
     *
     * @param {string[]} texts
     * @param {{ taskType?: string }} options
     * @returns {Promise<number[][]>} one L2-normalized vector per input
     */
    async embed(texts, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {

        if (!Array.isArray(texts) || texts.length === 0) return [];

        await assertCanSpend(GEMINI_EMBEDDING_MODEL);

        let response;
        try {
            await recordSpend(GEMINI_EMBEDDING_MODEL);
            response = await gemini.models.embedContent({
                model: GEMINI_EMBEDDING_MODEL,
                contents: texts,
                config: {
                    taskType,
                    // Must match the Atlas index's numDimensions exactly; the index
                    // rejects a vector of any other length on write.
                    outputDimensionality: EMBEDDING_DIMENSIONS,
                },
            });
        } catch (error) {
            const classified = classifyProviderError(error);
            if (classified instanceof ProviderQuotaError && classified.daily) {
                await markExhausted(GEMINI_EMBEDDING_MODEL);
            }
            throw classified;
        }

        const vectors = response.embeddings ?? [];

        // A short response means some inputs were silently dropped, and since the
        // caller matches vectors to chunks by position, a short array would pair
        // every chunk after the gap with the wrong text.
        if (vectors.length !== texts.length) {
            throw new Error(
                `Gemini returned ${vectors.length} embeddings for ${texts.length} inputs`
            );
        }

        return vectors.map((vector, index) => {
            const values = vector?.values;

            if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
                throw new Error(
                    `Gemini returned a ${values?.length ?? 0}-dimension embedding for input ${index}; ` +
                    `EMBEDDING_DIMENSIONS is ${EMBEDDING_DIMENSIONS}`
                );
            }

            return normalize(values);
        });
    },


}


