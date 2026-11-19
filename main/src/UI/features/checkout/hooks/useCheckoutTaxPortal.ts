import { useEffect, useRef, useState } from 'react';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { createPortalSession_IO } from '../../../../domain/account/accountIO.possibilities.api';
import {
  clearCheckoutPortalIntent,
  saveCheckoutPortalIntent,
  type CheckoutPortalIntent,
} from '../checkout-portal-intent';

export async function prepareCheckoutTaxPortal(
  intent: Omit<CheckoutPortalIntent, 'createdAt'>,
  locale: 'pl' | 'en' | 'de',
  isActive: () => boolean
): Promise<string | null> {
  const { url } = await createPortalSession_IO({ purpose: 'manage', locale });
  if (!isActive()) {
    return null;
  }
  if (!url) {
    throw new Error('Missing portal URL');
  }
  saveCheckoutPortalIntent({ ...intent, createdAt: Date.now() });
  return url;
}

export function useCheckoutTaxPortal(
  intent: Omit<
    CheckoutPortalIntent,
    'userId' | 'createdAt' | 'billingCountry'
  > & {
    billingCountry?: CheckoutPortalIntent['billingCountry'] | undefined;
  }
) {
  const { data: user } = useCurrentUserAccount();
  const locale = useCurrentLang();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
    };
  }, []);
  const open = async () => {
    if (busyRef.current || !user || !intent.billingCountry) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const url = await prepareCheckoutTaxPortal(
        { ...intent, billingCountry: intent.billingCountry, userId: user.id },
        locale === 'de' || locale === 'en' ? locale : 'pl',
        () => alive.current
      );
      if (url === null) {
        return;
      }
      window.location.assign(url);
      // Keep the UI recoverable if navigation is blocked.
      timeout.current = setTimeout(() => {
        clearCheckoutPortalIntent();
        busyRef.current = false;
        setBusy(false);
        setFailed(true);
      }, 4000);
    } catch {
      if (!alive.current) {
        return;
      }
      clearCheckoutPortalIntent();
      busyRef.current = false;
      setBusy(false);
      setFailed(true);
    }
  };
  return { open, busy, failed, isBusy: () => busyRef.current };
}
