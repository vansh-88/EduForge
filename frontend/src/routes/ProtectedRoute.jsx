import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// loginWithRedirect is a full page navigation, so an in-memory guard is wiped
// before we come back. This has to outlive the reload to notice Auth0 sending
// us straight back still signed out.
const ATTEMPT_KEY = 'eduforge.auth.loginAttempts';

// A redirect loop burns through attempts in a couple of seconds. A person
// returning to the tab later is well outside the window and starts clean, so
// normal visits always auto-redirect.
const MAX_ATTEMPTS = 3;
const WINDOW_MS = 20000;

const readAttempts = () => {
  try {
    return JSON.parse(sessionStorage.getItem(ATTEMPT_KEY)) ?? null;
  } catch {
    return null;
  }
};

const writeAttempts = (record) => {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable (private mode): losing the guard only costs us the
    // loop protection, so carry on rather than blocking sign-in.
  }
};

const clearAttempts = () => {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* see writeAttempts */
  }
};

// What this page load's attempt would be. Pure — the counter is only persisted
// once we actually redirect.
const nextAttempt = () => {
  const now = Date.now();
  const previous = readAttempts();

  return previous && now - previous.firstAt < WINDOW_MS
    ? { count: previous.count + 1, firstAt: previous.firstAt }
    : { count: 1, firstAt: now };
};

export const ProtectedRoute = () => {
  const { isAuthenticated, isLoading, error, login } = useAuth();
  const location = useLocation();

  // Fixed for this page load: the redirect navigates away, so it never needs
  // to be recomputed.
  const [attempt] = useState(nextAttempt);

  const settled = !isLoading && !isAuthenticated;
  // A real Auth0 error is worth showing rather than retrying blindly; too many
  // attempts in the window means we're bouncing.
  const blocked = settled && (Boolean(error) || attempt.count > MAX_ATTEMPTS);

  useEffect(() => {
    if (isLoading || blocked) return;

    if (isAuthenticated) {
      clearAttempts();
      return;
    }

    writeAttempts(attempt);
    login({ appState: { returnTo: `${location.pathname}${location.search}` } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, blocked]);

  if (blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-lg border border-danger-line bg-danger-soft p-6">
          <h1 className="text-lg font-semibold text-danger-strong">Sign-in failed</h1>
          <p className="mt-2 text-sm text-danger-text">
            {error?.message ??
              'Auth0 kept redirecting back without signing you in. Check that this app’s Allowed Callback URLs, Logout URLs, and Web Origins include http://localhost:5173, and that the API audience matches the backend.'}
          </p>
          <button
            type="button"
            onClick={() => {
              clearAttempts();
              window.location.replace(`${location.pathname}${location.search}`);
            }}
            className="mt-4 rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger-hover"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <div>Redirecting to login...</div>;
  }

  return <Outlet />;
};
