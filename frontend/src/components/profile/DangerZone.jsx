import { useState } from 'react';
import { Button, Input } from '../common';

const CONFIRM_WORD = 'DELETE';

/**
 * Account deletion.
 *
 * Gated behind typing the word rather than a browser confirm(): this removes
 * every course, lesson and answer the account owns, with no undo and no export,
 * and a dialog people dismiss by reflex is not a real check.
 *
 * The copy is explicit that the login survives, because "delete my account"
 * usually means the identity too — and here it does not.
 */
export const DangerZone = ({ onDelete }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);

  const canDelete = confirmation.trim() === CONFIRM_WORD && !isDeleting;

  const handleDelete = async () => {
    if (!canDelete) return;

    setIsDeleting(true);
    setError(null);
    try {
      await onDelete();
      // On success the caller signs the user out, so this component unmounts —
      // deliberately not clearing isDeleting, to keep the button inert during
      // the redirect.
    } catch (err) {
      setError(err.message);
      setIsDeleting(false);
    }
  };

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-5">
      <h2 className="font-semibold text-red-900">Delete your data</h2>

      <p className="mt-1 text-sm text-red-700">
        Permanently removes every course, lesson, quiz answer and progress record
        on this account. This cannot be undone.
      </p>

      <p className="mt-2 text-xs text-red-600">
        Your sign-in is not deleted — logging in again creates a new, empty account.
      </p>

      {!isOpen ? (
        <Button variant="secondary" className="mt-4" onClick={() => setIsOpen(true)}>
          Delete my data
        </Button>
      ) : (
        <div className="mt-4 max-w-sm">
          <label htmlFor="confirm-delete" className="text-sm font-medium text-red-900">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </label>

          <Input
            id="confirm-delete"
            className="mt-1"
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={CONFIRM_WORD}
          />

          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              disabled={!canDelete}
              loading={isDeleting}
              onClick={handleDelete}
            >
              Delete everything
            </Button>

            <Button
              variant="secondary"
              disabled={isDeleting}
              onClick={() => {
                setIsOpen(false);
                setConfirmation('');
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};
