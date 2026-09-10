import { youtubeProvider } from './youtube.js';
import { VIDEO_PROVIDER } from '../../config/env.config.js';

const providerName = VIDEO_PROVIDER;

let activeProvider;

switch (providerName.toLowerCase()) {
  case 'youtube':
    activeProvider = youtubeProvider;
    break;
  default:
    throw new Error(`Unsupported video provider: ${providerName}`);
}

// The active provider, consumed by videoService. Every caller goes through the
// service, so nothing outside this folder should ever import a provider by name.
export const provider = activeProvider;
