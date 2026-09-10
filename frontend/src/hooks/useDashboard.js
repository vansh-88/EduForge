import { useCallback, useEffect, useState } from 'react';
import { getDashboard } from '../api/dashboard.api';

export const useDashboard = () => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped to re-run the effect; keeps the fetch owned by the effect rather
  // than by a callback that would setState synchronously on mount.
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const result = await getDashboard();
        if (controller.signal.aborted) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err);
      } finally {
        // StrictMode mounts twice in dev; the abort flag keeps the discarded
        // run from writing state after unmount.
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [reloadKey]);

  return { data, isLoading, error, refetch };
};
