// Bridge between the Auth0 React SDK (only reachable from a hook inside a
// component) and the axios client (a plain module). `useAuth` registers the
// real getter on mount; `client.js` calls it on every request.
let tokenGetter = null;

export const setTokenGetter = (fn) => {
  tokenGetter = fn;
};

export const getToken = () => {
  if (!tokenGetter) return Promise.resolve(null);
  return tokenGetter();
};
