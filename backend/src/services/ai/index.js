import { geminiProvider } from './gemini.js';
import { AI_PROVIDER } from '../../config/env.config.js';

const providerName = AI_PROVIDER;

let activeProvider;

switch (providerName.toLowerCase()) {
    case 'gemini':
        activeProvider = geminiProvider;
        break;
    default:
        throw new Error(`Unsupported AI provider: ${providerName}`);
}

// Export the active provider instance to be consumed by aiService
export const provider = activeProvider;