import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One GET-shaped resource: fetch on mount, refetch on demand, patch locally.
 *
 * Generalized from the original useDashboard, which every screen was otherwise
 * going to copy. Four parts are deliberate:
 *
 * - `reloadKey` rather than calling the fetcher from `refetch` directly. The
 *   fetch stays owned by the effect, so there is exactly one code path that
 *   writes results.
 *
 * - The AbortController is a *write guard*, not a request cancellation — it is
 *   never handed to axios. StrictMode mounts twice in dev and the discarded run
 *   would otherwise write state after unmount.
 *
 * - `isLoading` means "there is nothing valid to show", NOT "a request is in
 *   flight". Conflating the two makes every background refresh blank the page:
 *   a video slot resolving would replace a lesson the reader is halfway through
 *   with a spinner, losing their scroll position and any local block state.
 *   `isRefreshing` covers the in-flight case for callers that want a hint.
 *
 * - A failed *background* refresh does not surface as `error`. Pages render an
 *   error state instead of their content, so a network blip during a refresh
 *   would throw away a perfectly readable page. It lands in `refreshError`.
 *
 * `deps` are the scalar values the fetcher closes over (a courseId, a page
 * number, a search string) — pass values, not objects, since they are compared
 * by joining. The fetcher itself is held in a ref, so callers may pass a fresh
 * arrow function on every render without looping.
 */
export const useApiResource = (fetcher, deps = []) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const [isFetching, setIsFetching] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // NUL as the separator: it cannot occur inside an id or a search string, so
  // ['a b','c'] and ['a','b c'] stay distinct. A plain join(',') or join(' ')
  // would collapse them and silently skip a refetch.
  const depsKey = deps.join('\u0000');

  // Which deps the data in hand was fetched for. This is what distinguishes
  // "refreshing this resource" (data still valid, keep showing it) from
  // "switching to a different resource" (data now belongs to something else).
  const [dataKey, setDataKey] = useState(null);

  // Adjusting state during render: when the caller asks for a *different*
  // resource, the previous one's error must not carry over into it.
  const [renderedKey, setRenderedKey] = useState(depsKey);
  if (renderedKey !== depsKey) {
    setRenderedKey(depsKey);
    setError(null);
    setRefreshError(null);
  }

  const hasCurrentData = data !== null && dataKey === depsKey;

  const refetch = useCallback(() => {
    setIsFetching(true);
    setReloadKey((key) => key + 1);
  }, []);

  // Held in a ref and updated in its own effect, so an inline fetcher closure
  // never becomes a dependency of the fetch below. Declared first: effects run
  // in declaration order, so the ref is current before the fetch reads it.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Read at call time so the fetch effect does not depend on it, which would
  // restart the request every time data arrives.
  const hasCurrentDataRef = useRef(hasCurrentData);
  useEffect(() => {
    hasCurrentDataRef.current = hasCurrentData;
  });

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const result = await fetcherRef.current();
        if (controller.signal.aborted) return;
        setData(result);
        setDataKey(depsKey);
        setError(null);
        setRefreshError(null);
      } catch (err) {
        if (controller.signal.aborted) return;

        // Only destroy the view when there is nothing to fall back on.
        if (hasCurrentDataRef.current) setRefreshError(err);
        else setError(err);
      } finally {
        if (!controller.signal.aborted) setIsFetching(false);
      }
    })();

    return () => controller.abort();
  }, [reloadKey, depsKey]);

  return {
    data,
    // Nothing to show yet: first load, or the deps changed so what we hold
    // belongs to a different resource. Deliberately false once a fetch has
    // settled with no data, so an error branch is reachable rather than
    // spinning forever.
    isLoading: isFetching && !hasCurrentData,
    isRefreshing: isFetching,
    error,
    refreshError,
    refetch,
    // Exposed so mutations that already return the updated state — answering an
    // MCQ, completing a lesson — can patch in place instead of refetching a
    // whole resource to learn something the response already told us.
    setData,
  };
};
