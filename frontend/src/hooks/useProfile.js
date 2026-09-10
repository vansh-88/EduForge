import { useCallback, useState } from 'react';
import { useApiResource } from './useApiResource';
import { getMe, getMyStats, updateMe, uploadAvatar, deleteAvatar } from '../api/user.api';

/**
 * The profile screen's data: the account, and the same learning statistics the
 * dashboard shows.
 *
 * Fetched together in one resource so the page has a single loading and error
 * state rather than two that can disagree. `computeUserStats` is the shared
 * source for those numbers, so the dashboard and this page can never drift.
 */
export const useProfile = () => {
  const { data, isLoading, error, refetch, setData } = useApiResource(async () => {
    const [user, stats] = await Promise.all([getMe(), getMyStats()]);
    return { user, stats };
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Every mutation here returns the updated user, so the local copy is patched
  // rather than refetched — re-running two aggregations to learn a new display
  // name would be wasteful, and would blank the page while it loaded.
  const patchUser = useCallback(
    (user) => setData((previous) => (previous ? { ...previous, user } : previous)),
    [setData]
  );

  const saveName = useCallback(
    async (name) => {
      setIsSaving(true);
      try {
        patchUser(await updateMe({ name }));
      } finally {
        setIsSaving(false);
      }
    },
    [patchUser]
  );

  const changeAvatar = useCallback(
    async (file) => {
      setIsUploading(true);
      try {
        patchUser(await uploadAvatar(file));
      } finally {
        setIsUploading(false);
      }
    },
    [patchUser]
  );

  const removeAvatar = useCallback(async () => {
    setIsUploading(true);
    try {
      patchUser(await deleteAvatar());
    } finally {
      setIsUploading(false);
    }
  }, [patchUser]);

  return {
    user: data?.user ?? null,
    stats: data?.stats ?? null,
    isLoading,
    error,
    refetch,
    saveName,
    isSaving,
    changeAvatar,
    removeAvatar,
    isUploading,
  };
};
