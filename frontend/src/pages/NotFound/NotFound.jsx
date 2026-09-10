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
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
          404
        </p>

        <h1 className="mt-3 text-2xl font-bold text-gray-900 sm:text-3xl">
          We couldn't find that page
        </h1>

        <p className="mt-2 text-sm text-gray-500">
          The link may be broken, or the course it pointed to may have been deleted.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Back to dashboard
          </Link>

          <Link
            to="/courses"
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Your courses
          </Link>
        </div>
      </div>
    </main>
  );
}
