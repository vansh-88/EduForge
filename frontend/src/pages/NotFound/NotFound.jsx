import { Link } from 'react-router-dom';

/**
 * 404.
 *
 * Deliberately rendered outside ProtectedRoute and AppLayout: a mistyped URL
 * should say so, not bounce the visitor into a login redirect. That means it
 * gets no navbar, so it has to carry its own way out — otherwise a signed-in
 * user who fat-fingers a link is left with only the browser's back button.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary-text">
          404
        </p>

        <h1 className="mt-3 text-2xl font-bold text-ink sm:text-3xl">
          We couldn't find that page
        </h1>

        <p className="mt-2 text-sm text-muted">
          The link may be broken, or the course it pointed to may have been deleted.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Back to dashboard
          </Link>

          <Link
            to="/courses"
            className="inline-flex items-center rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-body transition hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Your courses
          </Link>
        </div>
      </div>
    </main>
  );
}
