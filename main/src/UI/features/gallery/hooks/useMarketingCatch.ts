// UI/features/gallery/hooks/useMarketingCatch.ts
// Optional post-publication consent. The successful publication actions remain
// available while this independent preference is pending or has failed.
// DECISION: the marketingCatchKey latch remains per account, and successful
// opt-in preserves trial_sequence through the existing email-preferences hook.

import { useMemo, useState } from 'react';
import { DEFAULT_EMAIL_PREFERENCES } from '@kernel/models/email/email.dto';
import {
  getFromClientStorage,
  setToClientStorage,
} from '../../../../application/client-device-storage/clientStorage.possibilities.api';
import { marketingCatchKey } from '../../../../application/client-device-storage/storage-keys.config';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useUpdateEmailPreferences } from '../../shared/email/hooks/useUpdateEmailPreferences';

export interface MarketingCatch {
  /** Whether to show the prompt: a stylist with marketing=false, not yet asked. */
  eligible: boolean;
  /** Opt-in mutation in flight (drives the button loading state). */
  isPending: boolean;
  status: 'idle' | 'pending' | 'complete' | 'error';
  /** Preserve trial_sequence; notify only after confirmed save. */
  optIn: (onDone: () => void) => void;
  /** Dismiss (remember „pytano") → call `onDone`. */
  dismiss: (onDone: () => void) => void;
}

export function useMarketingCatch(): MarketingCatch {
  const { data: currentUser } = useCurrentUserAccount();
  const { mutate, isPending } = useUpdateEmailPreferences();

  // Immediate hide signal after the action (the storage read is memoized on
  // accountId, so the write alone would not refresh `eligible` in this render).
  const [answeredLocally, setAnsweredLocally] = useState(false);
  const [status, setStatus] = useState<MarketingCatch['status']>('idle');

  const stylistAccount = currentUser?.stylist_account ?? null;
  const prefs = stylistAccount?.email_preferences ?? null;
  const accountId = currentUser?.id ?? null;

  const alreadyAsked = useMemo(
    () =>
      accountId != null &&
      getFromClientStorage({ key: marketingCatchKey(accountId) }) === 'true',
    [accountId]
  );

  // null email_preferences (legacy/edge stylist) = no consent = treat as the
  // DEFAULT (marketing:false) → eligible for the prompt, consistent with the SSOT.
  const marketingOn = prefs?.marketing ?? DEFAULT_EMAIL_PREFERENCES.marketing;
  const eligible =
    stylistAccount != null &&
    marketingOn === false &&
    !alreadyAsked &&
    !answeredLocally;

  const markAsked = () => {
    if (accountId != null) {
      setToClientStorage({
        key: marketingCatchKey(accountId),
        value: 'true',
      });
    }
    setAnsweredLocally(true);
  };

  const optIn = (onDone: () => void) => {
    if (isPending) {
      return;
    }
    setStatus('pending');
    const current = prefs ?? DEFAULT_EMAIL_PREFERENCES;
    mutate(
      {
        trial_sequence: current.trial_sequence,
        marketing: true,
        source: 'gallery_prompt',
      },
      {
        onSuccess: () => {
          markAsked();
          setStatus('complete');
          onDone();
        },
        onError: () => setStatus('error'),
      }
    );
  };

  const dismiss = (onDone: () => void) => {
    markAsked();
    onDone();
  };

  return { eligible, isPending, status, optIn, dismiss };
}
