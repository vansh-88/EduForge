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
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);