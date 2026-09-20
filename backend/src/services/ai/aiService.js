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


/**
 * Embeds `texts`, returning one vector per input in the same order.
 *
 * Routed through the service layer like the other two so callers depend on the
 * facade rather than reaching for a provider directly, and a second embedding
 * vendor stays a change to services/ai/index.js alone.
 *
 * No validation step: the provider already checked that it returned the right
 * number of vectors at the right dimension, which is the only contract there is.
 *
 * @param {string[]} texts
 * @param {{ taskType?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' }} options
 */
export async function embedTexts(texts, options) {

    if (typeof provider.embed !== 'function') {
        throw new Error('The configured AI provider does not support embeddings');
    }

    return await provider.embed(texts, options);
}


/**
 * One tutor turn, returned whole.
 *
 * Routed through the facade like the others so callers depend on the service layer
 * and a second chat vendor stays a change to services/ai/index.js alone.
 *
 * No validation step: unlike generateStructured there is no schema to check against.
 * The provider either produced prose or threw.
 */
export async function chat(params) {

    if (typeof provider.chat !== 'function') {
        throw new Error('The configured AI provider does not support chat');
    }

    return await provider.chat(params);
}


/**
 * One tutor turn, streamed.
 *
 * Returns the provider's async generator directly rather than wrapping it: buffering
 * to re-yield would defeat the only reason this exists, and there is nothing to
 * validate between the provider and the caller.
 */
export function chatStream(params) {

    if (typeof provider.chatStream !== 'function') {
        throw new Error('The configured AI provider does not support streaming chat');
    }

    return provider.chatStream(params);
}
