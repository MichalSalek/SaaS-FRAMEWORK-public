import { useEffect, useRef, useState } from 'react';
import type { PendingSubscriptionPayment } from '@kernel/models/session/session.dto';

/** Poll only visible recovery. Two short follow-up reads let entitlement webhooks settle. */
export function usePendingPaymentRefresh(
  payment: PendingSubscriptionPayment | undefined,
  refresh: () => void,
  enabled = true
) {
  const [clock, setClock] = useState(Date.now);
  const previouslyPending = useRef(false);
  useEffect(() => {
    if (!enabled) {
      previouslyPending.current = false;
      return;
    }
    const check = () => {
      setClock(Date.now());
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    if (!payment) {
      if (!previouslyPending.current) {
        return;
      }
      previouslyPending.current = false;
      const timers = [setTimeout(check, 15_000), setTimeout(check, 30_000)];
      return () => timers.forEach(clearTimeout);
    }
    previouslyPending.current = true;
    const timer = setInterval(check, 15_000);
    const remaining =
      payment.expiresAt === null
        ? 0
        : new Date(payment.expiresAt).getTime() - Date.now();
    const expiry = remaining > 0 ? setTimeout(check, remaining) : null;
    return () => {
      clearInterval(timer);
      if (expiry !== null) {
        clearTimeout(expiry);
      }
    };
  }, [payment, refresh, enabled]);
  return (
    payment?.expiresAt != null &&
    new Date(payment.expiresAt).getTime() <= Math.max(clock, Date.now())
  );
}
