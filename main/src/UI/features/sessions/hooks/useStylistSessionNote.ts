// UI/features/sessions/hooks/useStylistSessionNote.ts
// The stylist's private note on a session: the field's value, save on blur,
// the failure marker and the save on leaving the screen.

import { useEffect, useRef, useState } from 'react';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { useUpdateSessionNote } from './useUpdateSessionNote';

export function useStylistSessionNote(
  sessionId: string,
  session: SessionContainerDetailDTO | undefined
) {
  const updateNote = useUpdateSessionNote(sessionId);
  const [value, setValue] = useState('');
  const [initialized, setInitialized] = useState(false);
  // Save-on-blur has no button, so a failed save must leave a mark next to the
  // note (the interceptor toast disappears; the text stays in the field).
  const [failed, setFailed] = useState(false);
  // Latest typed value, read after a save settles: an edit made while the
  // previous save was in flight is otherwise never sent (blur is ignored
  // during a pending save).
  const latest = useRef(value);
  latest.current = value;
  const saved = session ? (session.stylistNote ?? '') : null;

  // The page keys this hook's owner by session id, so the note is seeded once.
  useEffect(() => {
    if (session && !initialized) {
      setValue(session.stylistNote ?? '');
      setInitialized(true);
    }
  }, [session, initialized]);

  // Leaving the screen is not always a blur (Android back, the tab bar): a
  // note still only in the field is sent on the way out. Skipped when it is
  // already saved or already handed to a save in flight.
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const lastSent = useRef<string | null>(null);
  const send = useRef(updateNote.mutate);
  send.current = updateNote.mutate;
  const seeded = useRef(false);
  seeded.current = initialized;
  useEffect(
    () => () => {
      const typed = latest.current.trim();
      if (
        seeded.current &&
        savedRef.current !== null &&
        typed !== savedRef.current &&
        typed !== lastSent.current
      ) {
        send.current(latest.current);
      }
    },
    []
  );

  function save(next: string) {
    lastSent.current = next.trim();
    updateNote.mutate(next, {
      onSuccess: () => {
        setFailed(false);
        if (latest.current.trim() !== next.trim()) {
          save(latest.current);
        }
      },
      onError: () => setFailed(true),
    });
  }

  const dirty = saved !== null && value.trim() !== saved;
  return {
    value,
    setValue,
    // No-op guard: the backend trims and stores whitespace as null, and
    // `saved` IS that stored value, so an unchanged focus and blur sends
    // nothing; nor does a blur while a save is in flight.
    saveOnBlur: () => {
      if (!updateNote.isPending && dirty) {
        save(value);
      }
    },
    retry: () => save(value),
    isSaving: updateNote.isPending,
    saveFailed: failed && !updateNote.isPending && dirty,
    dirty,
    acknowledged: updateNote.isSuccess,
  };
}
