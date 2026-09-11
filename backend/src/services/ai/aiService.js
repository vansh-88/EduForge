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

/**
 * Speaks `text`, returning ready-to-upload WAV bytes.
 *
 * No validation step, unlike generateStructured — the provider either produced
 * audio or threw. Routed through here anyway so callers depend on the service
 * layer rather than reaching for a provider directly, and a second TTS vendor is
 * a change to services/ai/index.js alone.
 */
export async function synthesizeSpeech(text, options) {

    if (typeof provider.synthesizeSpeech !== 'function') {
        throw new Error('The configured AI provider does not support speech synthesis');
    }

    return await provider.synthesizeSpeech(text, options);
}