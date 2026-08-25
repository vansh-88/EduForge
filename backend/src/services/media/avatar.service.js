import { cloudinary } from '../../config/cloudinary.config.js';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } from '../../config/env.config.js';
import { ApiError } from '../../utils/ApiError.js';

const FOLDER = 'eduforge/avatars';
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * The asset id for a user's avatar, derived from their id rather than chosen by the
 * client. This is what makes signed direct upload safe:
 *
 *  - the signature pins the public_id, so a client cannot upload to anyone else's path
 *  - confirm never trusts a client-supplied id — the server already knows it
 *  - replacing an avatar overwrites the same asset, so there is no previous file to
 *    track or clean up
 */
export function avatarPublicId(userId) {
  return `${FOLDER}/${userId}`;
}

/**
 * Everything the browser needs to upload directly to Cloudinary. The API secret is
 * used to sign and never leaves the server.
 */
export function createUploadSignature(userId) {
  const timestamp = Math.round(Date.now() / 1000);
  const publicId = avatarPublicId(userId);

  // These must match exactly what the client sends, or Cloudinary rejects the upload.
  const params = { timestamp, public_id: publicId, overwrite: true, invalidate: true };

  return {
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    signature: cloudinary.utils.api_sign_request(params, CLOUDINARY_API_SECRET),
    ...params,
  };
}

/**
 * Reads the asset straight from Cloudinary and validates it. Takes no client input at
 * all — the id is derived — so there is nothing here to spoof.
 *
 * Validation is necessarily after the fact with direct upload: a client can push an
 * oversized or non-image file before we ever see it. We detect it and destroy it.
 */
export async function verifyUploadedAvatar(userId) {
  const publicId = avatarPublicId(userId);
  let resource;

  try {
    resource = await cloudinary.api.resource(publicId);
  } catch (error) {
    if (error?.error?.http_code === 404) {
      throw ApiError.notFound('No uploaded image found for this account', { code: 'AVATAR_NOT_UPLOADED' });
    }
    throw error;
  }

  const reject = async (message, code) => {
    // Do not leave a rejected asset sitting in the account.
    await destroyAvatar(publicId);
    throw ApiError.badRequest(message, { code });
  };

  if (resource.resource_type !== 'image') {
    await reject('Uploaded file must be an image', 'AVATAR_NOT_AN_IMAGE');
  }

  if (!ALLOWED_FORMATS.includes(resource.format)) {
    await reject(`Image format must be one of: ${ALLOWED_FORMATS.join(', ')}`, 'AVATAR_BAD_FORMAT');
  }

  if (resource.bytes > MAX_BYTES) {
    await reject(`Image must be ${MAX_BYTES / (1024 * 1024)}MB or smaller`, 'AVATAR_TOO_LARGE');
  }

  // The image is good, but the same signature could also have been used to park a raw
  // or video file under this id. Clear those out.
  await sweepNonImageVariants(publicId);

  return {
    publicId: resource.public_id,
    // The versioned URL changes on every overwrite, which cache-busts the CDN for free.
    url: resource.secure_url,
  };
}

// `resource_type` is a URL path segment, not a signable upload parameter, so our
// signature cannot pin it. A client holding a valid avatar signature can therefore POST
// to the raw or video endpoints under the same public_id. Those uploads are invisible to
// an image-scoped lookup, so every removal has to sweep all three types or they linger
// in the account forever.
const RESOURCE_TYPES = ['image', 'raw', 'video'];

/**
 * Deletes by PREFIX rather than by exact id.
 *
 * Cloudinary appends the uploaded file's extension to the public_id for raw and video
 * resources — a PDF parked at `<id>` actually lands at `<id>.pdf`. An exact-id destroy
 * silently returns "not found" and leaves it behind, and the extension is chosen by the
 * client so it cannot be enumerated. A prefix delete catches every variant.
 *
 * Safe against collisions: a Mongo ObjectId is fixed-length hex, so one user's id can
 * never be a prefix of another's — only of that same user's `<id>.<ext>` variants.
 */
async function purgeByPrefix(prefix, resource_type) {
  try {
    const res = await cloudinary.api.delete_resources_by_prefix(prefix, { resource_type, invalidate: true });
    return Object.keys(res?.deleted ?? {}).length > 0;
  } catch (error) {
    console.error(`[Avatar] purge failed for ${prefix} (${resource_type}):`, error?.error?.message ?? error.message);
    return false;
  }
}

/**
 * Best-effort removal of the avatar and anything parked alongside it. A failure here
 * must not fail the request that triggered it — one orphaned asset is preferable to a
 * user being unable to remove their picture or delete their account.
 */
export async function destroyAvatar(publicId) {
  if (!publicId) return false;

  const results = await Promise.all(RESOURCE_TYPES.map((type) => purgeByPrefix(publicId, type)));
  return results.some(Boolean);
}

/**
 * Removes anything a client parked under the avatar id that is NOT the image we just
 * accepted — the raw/video loophole above.
 */
export async function sweepNonImageVariants(publicId) {
  await Promise.all(['raw', 'video'].map((type) => purgeByPrefix(publicId, type)));
}

export const AVATAR_LIMITS = { allowedFormats: ALLOWED_FORMATS, maxBytes: MAX_BYTES, folder: FOLDER };
