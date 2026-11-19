import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { persistNativeEntryResolved } from '../../../application/lifecycle/native-entry-storage';
import { scheduleNativeStartupReady } from '../../../application/lifecycle/native-startup';

export type NativeEntryStartupPhase =
  'idle' | 'checking' | 'unavailable' | 'navigating' | 'settled';

type NativeEntryBootstrapReadinessOptions = {
  phase: NativeEntryStartupPhase;
  pathname: string;
  target: string | null;
  setPhase: Dispatch<SetStateAction<NativeEntryStartupPhase>>;
};

/** Persist the entry latch only after navigation commits, then release the shell splash. */
export function useNativeEntryBootstrapReadiness({
  phase,
  pathname,
  target,
  setPhase,
}: NativeEntryBootstrapReadinessOptions): void {
  const readyScheduledRef = useRef(false);

  useEffect(() => {
    const routeReady =
      phase === 'navigating' && target !== null && pathname === target;
    if (!routeReady) {
      return;
    }

    persistNativeEntryResolved();
    setPhase('settled');
  }, [phase, pathname, setPhase, target]);

  useEffect(() => {
    if (
      (phase !== 'settled' && phase !== 'unavailable') ||
      readyScheduledRef.current
    ) {
      return;
    }
    readyScheduledRef.current = true;
    // This runs after the settled/error screen commit and deliberately has no cleanup: the phase
    // may change immediately after a user retries, but the shell is already ready to fade away.
    scheduleNativeStartupReady();
  }, [phase]);
}
