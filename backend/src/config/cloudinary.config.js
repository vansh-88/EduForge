import { v2 as cloudinary } from 'cloudinary';
import {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} from './env.config.js';

// Configured explicitly rather than relying on the SDK's implicit CLOUDINARY_URL
// lookup: that reads process.env when the SDK module is first imported, so it depends
// on dotenv having already run — an import-order trap that fails silently.
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };
