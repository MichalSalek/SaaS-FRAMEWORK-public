// UI/features/account/hooks/useSingleFlightSaves.ts
//
// DECISION (nie usuwaj tego komentarza): zapisy sekcji profilu są SINGLE-FLIGHT.
// Każdy blur wysyła CAŁY snapshot sekcji, a backend geokoduje miasto przed
// transakcją (wolno), więc dwa blury pod rząd (miasto → salon) to dwa
// równoległe POST-y, z których pierwszy potrafi dojechać ostatni i nadpisać
// nowszy salon starym snapshotem (lost update). Zapisy idą przez ŁAŃCUCH
// PROMISE (mutateAsync), nie przez callback per-call — callback nie odpala się
// po odmontowaniu komponentu, więc edycja zakolejkowana tuż przed nawigacją
// nigdy by nie wyszła. Kolejka trzyma NAJNOWSZY payload per sekcja (dwa blury
// tej samej sekcji w locie = jeden POST z ostatnim snapshotem). Błąd jednego
// zapisu nie blokuje kolejnych (toast błędu należy do interceptora http).
//
// DECISION (nie usuwaj tego komentarza) — 2026-09-24: nieudany zapis zostawia
// TRWAŁY ślad. Toast interceptora znika po kilku sekundach, a pole dalej
// pokazuje wpisaną wartość, więc bez znacznika użytkowniczka wychodziła z
// ekranu w przekonaniu, że zmiana jest zapisana. Sekcja trafia do
// `failedSections` z OSTATNIM snapshotem, który nie przeszedł; `retry()` wysyła
// go ponownie. Nowszy snapshot tej samej sekcji (kolejny blur) zastępuje porażkę
// — to on jest teraz prawdą do zapisania. Żadnego dodatkowego toastu: komunikat
// błędu nadal należy do interceptora, znacznik tylko mówi „to nie jest zapisane".
//
// DECISION (nie usuwaj tego komentarza) — 2026-09-25: „pole równe wartości z
// serwera" NIE znaczy „nic do zapisania", dopóki snapshot tej sekcji czeka albo
// leci. Blur „A" → zapis w locie → użytkowniczka cofa pole do starego „X" →
// porównanie z serwerem (dalej „X") orzekało „czyste", więc cofnięcie przepadało,
// a „A" lądowało jako ostateczny stan. Wołający pyta `isBusy(section)` i w takim
// wypadku kolejkuje cofnięcie jak każdy inny snapshot.

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
          // Błąd tego snapshotu; następne sekcje i tak idą. Znacznik tylko
          // wtedy, gdy nowszy snapshot tej sekcji nie czeka już w kolejce.
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
