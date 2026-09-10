import { useState } from 'react';
import { useProfile } from '../../hooks/useProfile';
import { useAuth } from '../../hooks/useAuth';
import { deleteMe } from '../../api/user.api';
import { Button, Input, Spinner, ErrorState } from '../../components/common';
import { AvatarUploader } from '../../components/profile/AvatarUploader';
import { DangerZone } from '../../components/profile/DangerZone';
import { CourseStats } from '../../components/dashboard/CourseStats';

const NameForm = ({ user, onSave, isSaving }) => {
  const serverName = user.name ?? '';

  const [name, setName] = useState(serverName);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  // The server is the source of truth: when a save lands, or the profile is
  // refetched, the field follows it rather than holding a stale local edit.
  // Done during render rather than in an effect so the input never paints one
  // frame showing the old name. `saved` is deliberately left alone — this runs
  // as a *result* of a successful save, and clearing it here would wipe the
  // confirmation the save just set.
  const [syncedName, setSyncedName] = useState(serverName);
  if (syncedName !== serverName) {
    setSyncedName(serverName);
    setName(serverName);
  }

  // Matches updateUserSchema, so an invalid name is caught before a round trip.
  const validate = (value) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return 'Name must be at least 2 characters';
    if (trimmed.length > 100) return 'Name must be at most 100 characters';
    return null;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validationError = validate(name);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    try {
      await onSave(name.trim());
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const isDirty = name.trim() !== serverName;

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-sm">
      <Input
        label="Display name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(null);
          if (saved) setSaved(false);
        }}
        error={error}
      />

      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={!isDirty} loading={isSaving}>
          Save
        </Button>

        {saved && !isDirty && <span className="text-sm text-success-text">Saved</span>}
      </div>
    </form>
  );
};

export default function Profile() {
  const { logout } = useAuth();
  const {
    user,
    stats,
    isLoading,
    error,
    refetch,
    saveName,
    isSaving,
    changeAvatar,
    removeAvatar,
    isUploading,
  } = useProfile();

  const handleDeleteAccount = async () => {
    await deleteMe();
    // The account's data is gone; staying signed in would show an empty shell
    // built from a token whose user no longer has anything.
    logout();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-primary-text" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto mt-8 max-w-3xl">
        <ErrorState
          title="We couldn't load your profile"
          message={error.message}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-3xl pb-16">
      <h1 className="text-2xl font-bold text-ink">Profile</h1>

      <section className="mt-6 rounded-lg border border-line bg-surface p-5">
        <AvatarUploader
          user={user}
          onUpload={changeAvatar}
          onRemove={removeAvatar}
          isUploading={isUploading}
        />

        <NameForm user={user} onSave={saveName} isSaving={isSaving} />

        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm text-muted">Email</p>
          {/* Not editable: it comes from the identity provider, and changing it
              here would silently disagree with the account you sign in as. */}
          <p className="text-sm text-ink">{user.email}</p>
          <p className="mt-1 text-xs text-faint">Managed by your sign-in provider</p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Your learning</h2>
        <CourseStats stats={stats} />
      </section>

      <section className="mt-8">
        <Button variant="secondary" onClick={logout}>
          Sign out
        </Button>
      </section>

      <div className="mt-10">
        <DangerZone onDelete={handleDeleteAccount} />
      </div>
    </div>
  );
}
