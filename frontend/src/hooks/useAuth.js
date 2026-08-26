import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from '../api/authToken';

export const useAuth = () => {
  const {
    user: auth0User,
    isAuthenticated,
    isLoading,
    error,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  // Keep the token bridge pointed at the SDK's current getter so client.js can
  // reach it outside of React.
  useEffect(() => {
    setTokenGetter(getAccessTokenSilently);
  }, [getAccessTokenSilently]);

  const user = auth0User
    ? {
        id: auth0User.sub,
        name: auth0User.name ?? null,
        email: auth0User.email ?? null,
        picture: auth0User.picture ?? null,
      }
    : null;

  return {
    user,
    isAuthenticated,
    isLoading,
    // Surfaced so a failed init shows the real cause instead of silently
    // bouncing back into another login redirect.
    error,
    login: (options) => loginWithRedirect(options),
    logout: () => auth0Logout({ logoutParams: { returnTo: window.location.origin } }),
  };
};
