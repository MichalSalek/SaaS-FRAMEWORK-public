import { useEffect, useState } from 'react';
import { hasUploadDraftForUser } from '../../gallery/uploadDraft.availability';

/** Availability only. A file stays in the existing account-scoped draft adapter. */
export function useResumeUploadDraft(userId: string | null) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    setAvailable(null);
    if (!userId) {
      return;
    }
    let active = true;
    void hasUploadDraftForUser(userId)
      .then(found => {
        if (active) {
          setAvailable(found);
        }
      })
      .catch(() => {
        if (active) {
          setAvailable(false);
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);
  return available;
}
