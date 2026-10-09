// UI/features/auth/hooks/useResendCountdown.ts
// Seconds left until „wyślij ponownie” unlocks on the „Sprawdź skrzynkę” screen.

import { useEffect, useState } from 'react';

/** A mail usually lands within this window; an earlier resend only produces a
 *  second link that invalidates nothing and confuses which one to tap. */
export const RESEND_COOLDOWN_SECONDS = 30;

const TICK_MS = 1000;

/**
 * Counts down from RESEND_COOLDOWN_SECONDS to 0, once on mount and again every
 * time `restartKey` changes (each successful resend bumps it).
 */
export function useResendCountdown(restartKey: number): number {
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    setSecondsLeft(RESEND_COOLDOWN_SECONDS);
    const startedAt = Date.now();
    // Derived from the clock, not decremented: a throttled background tab
    // would otherwise come back showing a stale number.
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / TICK_MS);
      const left = Math.max(RESEND_COOLDOWN_SECONDS - elapsed, 0);
      setSecondsLeft(left);
      if (left === 0) {
        window.clearInterval(timer);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [restartKey]);

  return secondsLeft;
}
