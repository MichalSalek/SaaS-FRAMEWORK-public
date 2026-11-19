import { useCallback, useEffect, useState } from 'react';
import {
  isOptionalSuccessOfferSnoozed,
  snoozeOptionalSuccessOffers,
} from './optionalSuccessOfferSnooze';

interface SnoozeState {
  userId: string;
  isSnoozed: boolean;
}

export function useOptionalSuccessOfferSnooze(userId: string | null) {
  const [state, setState] = useState<SnoozeState | null>(null);

  useEffect(() => {
    if (userId === null) {
      setState(null);
      return;
    }

    try {
      setState({
        userId,
        isSnoozed: isOptionalSuccessOfferSnoozed(
          window.localStorage,
          userId,
          Date.now()
        ),
      });
    } catch {
      setState({ userId, isSnoozed: false });
    }
  }, [userId]);

  const dismiss = useCallback(() => {
    if (userId === null) {
      return;
    }

    try {
      snoozeOptionalSuccessOffers(window.localStorage, userId, Date.now());
    } catch {
      // The current offer still closes when browser storage is unavailable.
    }
    setState({ userId, isSnoozed: true });
  }, [userId]);

  return {
    isSnoozed: userId === null || state?.userId !== userId || state.isSnoozed,
    dismiss,
  };
}
