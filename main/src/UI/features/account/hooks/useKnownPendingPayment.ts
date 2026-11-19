import { useEffect, useState } from 'react';
import type { PendingSubscriptionPayment } from '@kernel/models/session/session.dto';
type Snapshot = {
  actorId: string;
  payment: PendingSubscriptionPayment | undefined;
};

/** A failed Stripe read is unknown, not evidence that the invoice was paid. */
export function useKnownPendingPayment(
  actorId: string | undefined,
  current: PendingSubscriptionPayment | undefined,
  known: boolean,
  enabled: boolean
) {
  const [previous, setPrevious] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!enabled || !actorId) {
      setPrevious(null);
      return;
    }
    if (known) {
      setPrevious({ actorId, payment: current });
    }
  }, [actorId, current, known, enabled]);
  if (!enabled || !actorId) {
    return undefined;
  }
  return known
    ? current
    : previous?.actorId === actorId
      ? previous.payment
      : undefined;
}
