// UI/shared/hooks/useLeaveGuard.ts
// Protect unsaved work on a screen: while `when` is true, leaving it asks
// first. Covers in-app navigation (tab bar, drawer, links, router.push),
// back (browser, Android gesture/button, i.e. popstate) with the in-app
// dialog, and reload/close with the browser's own prompt. Mechanism and why
// it lives in a module-level registry: DECISION in
// application/routing/leave-guard.ts.

import { useEffect } from 'react';
import {
  isLeaveBypassed,
  registerLeaveGuard,
} from '../../../application/routing/leave-guard';

export interface LeaveGuardOptions {
  /** Guard only while there is something to lose. */
  when: boolean;
  /** Translated dialog body: what exactly will be lost. */
  message: string;
}

export function useLeaveGuard({ when, message }: LeaveGuardOptions): void {
  useEffect(() => {
    if (!when) {
      return;
    }
    const release = registerLeaveGuard(message);
    // Attached only while guarding: a permanent beforeunload listener would
    // cost every page its BFCache eligibility in some browsers.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isLeaveBypassed()) {
        return;
      }
      event.preventDefault();
      // Chromium still needs returnValue set for the native prompt to appear.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      release();
    };
  }, [when, message]);
}
