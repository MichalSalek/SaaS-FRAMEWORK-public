import { useEffect } from 'react';
import { requestMaxBrightness } from '../../../application/platform/screen-brightness';

/**
 * Holds maximum screen brightness for the view's lifetime and restores the
 * previous value on exit.
 *
 * DECISION: the QR code and single-photo screens raise brightness by themselves: the code must
 * scan from another phone and the photo must show true colour. Outside the native shell only the
 * wake lock remains, and without it a no-op (`screen-brightness.ts`). The lease is async, so
 * cleanup waits for the promise; a fast enter and exit would leave the screen bright. (owner)
 *
 * DECISION: brightness belongs to the moment the code is ON SCREEN as the thing to scan, never
 * to the hook that prepares the code (held there, a code at the bottom of the salon profile lit
 * the phone on entry). A code that is not the screen's purpose sits in a disclosure and passes
 * `enabled = open`. (owner)
 */
export function useMaxScreenBrightness(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let released = false;
    const lease = requestMaxBrightness().then(value => {
      if (released) {
        void value.release();
      }
      return value;
    });
    return () => {
      released = true;
      void lease.then(value => value.release());
    };
  }, [enabled]);
}
