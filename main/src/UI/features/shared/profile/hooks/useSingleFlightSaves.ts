// UI/features/shared/profile/hooks/useSingleFlightSaves.ts
// DECISION: profile section saves are SINGLE-FLIGHT. Every blur sends the WHOLE section snapshot
// and the backend geocodes the city first (slow), so two blurs in a row are two parallel POSTs
// and the first can arrive last and overwrite the newer one. Saves run through a PROMISE CHAIN
// (mutateAsync), not a per-call callback, which does not fire after unmount. The queue keeps the
// NEWEST payload per section; one failed save does not block later ones.
// Test: main/src/UI/features/shared/profile/hooks/useSingleFlightSaves.test.ts (covers one request
// at a time and newest-snapshot-wins in a mocked mutation; not real network ordering).
//
// DECISION: a failed save leaves a PERSISTENT trace (the interceptor toast vanishes and the field
// still shows the typed value): the section goes into `failedSections` with its LAST failed
// snapshot, `retry()` resends it, a newer snapshot replaces it. The marker adds no toast.
//
// DECISION: "field equals the server value" does NOT mean "nothing to save" while that section's
// snapshot is queued or in flight; callers ask `isBusy(section)` and queue the revert as a snapshot.

import { useRef, useState } from 'react';

const NO_FAILURES: ReadonlySet<never> = new Set();

export interface SingleFlightSaves<S extends string, P> {
  /** Queue the newest snapshot of `section` (replaces a not-yet-sent one). */
  save: (section: S, payload: P) => void;
  /** Re-send the last failed snapshot of every failed section. */
  retry: () => void;
  /**
   * Drop the failure marker of `section` without re-sending: the field was
   * edited back to the saved value, so the failed snapshot is no longer wanted
   * (a later retry must not resurrect it).
   */
  discard: (section: S) => void;
  /**
   * `section` has a snapshot queued or in flight, so the server value the
   * caller compares against is about to change (read in event handlers only).
   */
  isBusy: (section: S) => boolean;
  /** A save is queued or in flight (drives the "Saving…" spinner). */
  isSaving: boolean;
  /** Sections whose latest snapshot failed and has not been superseded. */
  failedSections: ReadonlySet<S>;
}

export function useSingleFlightSaves<S extends string, P>(
  mutateAsync: (payload: P) => Promise<unknown>
): SingleFlightSaves<S, P> {
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(new Map<S, P>());
  const failedRef = useRef(new Map<S, P>());
  const inFlightRef = useRef<S | null>(null);
  const drainingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [failedSections, setFailedSections] =
    useState<ReadonlySet<S>>(NO_FAILURES);

  const publishFailures = (): void => {
    setFailedSections(
      failedRef.current.size === 0
        ? NO_FAILURES
        : new Set(failedRef.current.keys())
    );
  };

  const drain = (): void => {
    if (drainingRef.current) {
      return;
    }
    drainingRef.current = true;
    setIsSaving(true);
    chainRef.current = chainRef.current.then(async () => {
      for (;;) {
        const first = pendingRef.current.entries().next();
        if (first.done) {
          break;
        }
        const [section, payload] = first.value;
        pendingRef.current.delete(section);
        inFlightRef.current = section;
        try {
          await mutateAsync(payload);
        } catch {
          // This snapshot failed; the next sections go on anyway. The marker is set
          // only when no newer snapshot of this section waits in the queue.
          if (!pendingRef.current.has(section)) {
            failedRef.current.set(section, payload);
            publishFailures();
          }
        } finally {
          inFlightRef.current = null;
        }
      }
      drainingRef.current = false;
      setIsSaving(false);
    });
  };

  const save = (section: S, payload: P): void => {
    pendingRef.current.set(section, payload);
    if (failedRef.current.delete(section)) {
      publishFailures();
    }
    drain();
  };

  const retry = (): void => {
    if (failedRef.current.size === 0) {
      return;
    }
    for (const [section, payload] of failedRef.current) {
      if (!pendingRef.current.has(section)) {
        pendingRef.current.set(section, payload);
      }
    }
    failedRef.current.clear();
    publishFailures();
    drain();
  };

  const discard = (section: S): void => {
    if (failedRef.current.delete(section)) {
      publishFailures();
    }
  };

  const isBusy = (section: S): boolean =>
    inFlightRef.current === section || pendingRef.current.has(section);

  return { save, retry, discard, isBusy, isSaving, failedSections };
}
