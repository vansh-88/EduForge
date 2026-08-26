import { useNavigate } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

// Auth0Provider itself isn't router-aware, so the post-login redirect callback
// is wired up here instead, where useNavigate is reachable.
export const Auth0ProviderWithNavigate = ({ children }) => {
  const navigate = useNavigate();

  const onRedirectCallback = (appState) => {
    navigate(appState?.returnTo || window.location.pathname);
  };

  if (!domain || !clientId || !audience) {
    throw new Error(
      'Missing VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, or VITE_AUTH0_AUDIENCE in frontend/.env'
    );
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience,
      }}
      // Silent token renewal defaults to a hidden iframe, which needs
      // third-party cookies — blocked by default in most browsers now, and
      // broken outright while the tenant uses Auth0 dev keys. Refresh tokens
      // renew over a direct call instead, so getAccessTokenSilently keeps
      // working and a reload doesn't have to re-authorize.
      useRefreshTokens={true}
      cacheLocation="localstorage"
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
};
