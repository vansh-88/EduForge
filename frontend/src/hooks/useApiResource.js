import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One GET-shaped resource: fetch on mount, refetch on demand, patch locally.
 *
 * Generalized from the original useDashboard, which every screen was otherwise
 * going to copy. Three parts are deliberate:
 *
 * - `reloadKey` rather than calling the fetcher from `refetch` directly. The
 *   fetch stays owned by the effect, so there is exactly one code path that
 *   writes results.
 *
 * - The AbortController is a *write guard*, not a request cancellation — it is
 *   never handed to axios. StrictMode mounts twice in dev and the discarded run
 *   would otherwise write state after unmount.
 *
 * - Loading is reset during render when `deps` change, not inside the effect.
 *   Setting it in the effect body would render one frame of stale data labelled
 *   "loaded"; this is React's documented adjust-state-during-render pattern.
 *
 * `deps` are the scalar values the fetcher closes over (a courseId, a page
 * number, a search string) — pass values, not objects, since they are compared
 * by joining. The fetcher itself is held in a ref, so callers may pass a fresh
 * arrow function on every render without looping.
 */
export const useApiResource = (fetcher, deps = []) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // NUL as the separator: it cannot occur inside an id or a search string, so
  // ['a b','c'] and ['a','b c'] stay distinct. A plain join(',') or join(' ')
  // would collapse them and silently skip a refetch.
  const depsKey = deps.join('\u0000');

  // Adjusting state during render: when the caller asks for a *different*
  // resource, the previous one's data must stop being presented as current
  // immediately, in the same render that changed the deps.
  const [renderedKey, setRenderedKey] = useState(depsKey);
  if (renderedKey !== depsKey) {
    setRenderedKey(depsKey);
    setIsLoading(true);
    setError(null);
  }

  const refetch = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  // Held in a ref and updated in its own effect, so an inline fetcher closure
  // never becomes a dependency of the fetch below. Declared first: effects run
  // in declaration order, so the ref is current before the fetch reads it.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const result = await fetcherRef.current();
        if (controller.signal.aborted) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [reloadKey, depsKey]);

  // Exposed so mutations that already return the updated state — answering an
  // MCQ, completing a lesson — can patch in place instead of refetching a whole
  // lesson to learn something the response already told us.
  return { data, isLoading, error, refetch, setData };
};
