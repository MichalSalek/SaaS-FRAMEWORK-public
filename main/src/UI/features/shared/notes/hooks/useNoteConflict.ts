import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import { isIOError } from '../../../../../application/http/toPromise.adapter';

export type NoteRevision = { note: string | null; updatedAt: string | null };
export type NoteConflictState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; current: NoteRevision };

export function isNoteConflict(error: unknown): boolean {
  if (
    !isIOError(error) ||
    error.httpError.event !== APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
  ) {
    return false;
  }
  const data = error.httpError.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'field' in data &&
    data.field === 'note' &&
    'message' in data &&
    data.message === VALIDATION_MESSAGES.visit.crmNoteChanged
  );
}

/** Comparison never changes a draft's baseline; only an explicit action can use the fetched revision. */
export function useNoteConflict(
  error: unknown,
  saved: boolean,
  fetchCurrent: () => Promise<NoteRevision>
) {
  const [state, setState] = useState<NoteConflictState | null>(null);
  const generation = useRef(0);
  const handled = useRef<unknown>(null);
  const fetchRef = useRef(fetchCurrent);
  fetchRef.current = fetchCurrent;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setState({ status: 'loading' });
    try {
      const result = await fetchRef.current();
      if (generation.current === current) {
        setState({ status: 'ready', current: result });
      }
    } catch {
      if (generation.current === current) {
        setState({ status: 'failed' });
      }
    }
  }, []);
  useEffect(() => {
    if (error !== handled.current && isNoteConflict(error)) {
      handled.current = error;
      void refresh();
    }
  }, [error, refresh]);
  useEffect(() => {
    if (saved && state !== null) {
      generation.current += 1;
      setState(null);
    }
  }, [saved, state]);
  useEffect(
    () => () => {
      generation.current += 1;
      handled.current = null;
    },
    []
  );
  const dismiss = () => {
    generation.current += 1;
    setState(null);
  };
  return {
    state,
    refresh,
    dismiss,
    active: state !== null || isNoteConflict(error),
  };
}
