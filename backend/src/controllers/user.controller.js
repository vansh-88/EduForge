import { User } from '../models/user.model.js';
import { toUserDTO } from '../serializers/user.serializer.js';

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