export const toUserDTO = (user) => ({
  id: user._id.toString(),
  name: user.name ?? null,
  email: user.email,
  picture: user.picture ?? null,
});