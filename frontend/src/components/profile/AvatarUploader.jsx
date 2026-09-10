import { useRef, useState } from 'react';
import { Button, Spinner } from '../common';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/** Initials stand in before a picture is set — better than a generic silhouette. */
const initialsOf = (name, email) => {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

export const AvatarUploader = ({ user, onUpload, onRemove, isUploading }) => {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];

    // Clear immediately so picking the same file twice still fires a change
    // event — otherwise a failed upload cannot be retried with the same image.
    event.target.value = '';

    if (!file) return;

    setError(null);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemove = async () => {
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative">
        {user.picture ? (
          <img
            src={user.picture}
            alt=""
            className="h-20 w-20 rounded-full object-cover ring-1 ring-line"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-soft text-xl font-semibold text-primary-text">
            {initialsOf(user.name, user.email)}
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-veil">
            <Spinner size="sm" className="text-primary-text" />
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFile}
            className="hidden"
          />

          <Button
            variant="secondary"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {user.picture ? 'Change photo' : 'Upload photo'}
          </Button>

          {user.picture && (
            <Button variant="secondary" disabled={isUploading} onClick={handleRemove}>
              Remove
            </Button>
          )}
        </div>

        <p className="mt-2 text-xs text-faint">JPG, PNG, WebP or GIF · up to 5MB</p>

        {error && <p className="mt-2 text-xs text-danger-text">{error}</p>}
      </div>
    </div>
  );
};
