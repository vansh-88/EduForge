import { User } from '../models/user.model.js';
import { toUserDTO } from '../serializers/user.serializer.js';
import { computeUserStats } from '../services/stats/stats.service.js';
import { deleteUserAccount } from '../services/user/user.service.js';
import {
  createUploadSignature, verifyUploadedAvatar, destroyAvatar, avatarPublicId, AVATAR_LIMITS,
} from '../services/media/avatar.service.js';

export const getMe = (req, res) => {
  return res.status(200).json({
    success: true,
    data: toUserDTO(req.user),
  });
};

export const updateMe = async (req, res) => {
  // zod already stripped unknown keys, so this is safe to spread into $set
  const updates = req.validated.body;

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updates },
    { returnDocument: 'after', runValidators: true }
  );

  return res.status(200).json({
    success: true,
    data: toUserDTO(updatedUser),
  });
};

/**
 * Kept off GET /me on purpose: that endpoint does no DB work at all, and most profile
 * renders do not need three aggregations.
 */
export const getMyStats = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: await computeUserStats(req.user._id),
  });
};

export const deleteMe = async (req, res) => {
  const removed = await deleteUserAccount(req.user);

  return res.status(200).json({
    success: true,
    data: {
      deleted: true,
      removed,
      // Worth surfacing: this clears local data, not the identity provider account.
      note: 'Your EduForge data has been deleted. Your login still exists; signing in again creates a new empty account.',
    },
  });
};

/* -------------------------------------------------------------------------- */
/* Profile picture — signed direct upload to Cloudinary                        */
/* -------------------------------------------------------------------------- */

export const getPictureUploadSignature = (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      ...createUploadSignature(req.user._id),
      limits: { allowedFormats: AVATAR_LIMITS.allowedFormats, maxBytes: AVATAR_LIMITS.maxBytes },
    },
  });
};

/**
 * Takes no body. The asset id is derived from the authenticated user, so there is no
 * client-supplied value to trust or spoof.
 */
export const confirmPictureUpload = async (req, res) => {
  const { publicId, url } = await verifyUploadedAvatar(req.user._id);

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { picture: url, picturePublicId: publicId } },
    { returnDocument: 'after', runValidators: true }
  );

  return res.status(200).json({
    success: true,
    data: toUserDTO(updatedUser),
  });
};

export const deleteMyPicture = async (req, res) => {
  // Target the DERIVED id rather than the stored one: it is always correct, does not
  // depend on how fresh req.user is, and also clears anything parked under the id via
  // the raw/video upload loophole. Destroying an absent asset is a harmless no-op, so
  // an Auth0-sourced picture (no publicId) costs nothing here.
  await destroyAvatar(avatarPublicId(req.user._id));

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { picture: null, picturePublicId: null } },
    { returnDocument: 'after', runValidators: true }
  );

  return res.status(200).json({
    success: true,
    data: toUserDTO(updatedUser),
  });
};
