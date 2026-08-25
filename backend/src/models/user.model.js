import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    auth0Id: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
    },
    picture: {
      type: String,
      trim: true,
    },
    // Set only for avatars we uploaded to Cloudinary. Null means the picture came from
    // the Auth0 profile and is not ours to destroy.
    picturePublicId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);