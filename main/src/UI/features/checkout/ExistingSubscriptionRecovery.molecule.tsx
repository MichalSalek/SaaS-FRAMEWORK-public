import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isStripeHostedInvoiceUrl } from '@kernel/domain/stripe/hosted-invoice-url';
import { authClient } from '../../../application/auth/better-auth-client';
import { openExternalUrl } from '../../../application/platform/browser';
import { createPortalSession_IO } from '../../../domain/account/accountIO.possibilities.api';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { ButtonAtom } from '../../components/Button/Button.atom';

export function ExistingSubscriptionRecoveryMolecule() {
  const t = useTranslations('account.checkout');
  const paymentCopy = useTranslations('layout.pendingPayment');
  const { data: user, isError } = useCurrentUserAccount();
  const { data: session } = authClient.useSession();
  const locale = useCurrentLang();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const busyRef = useRef(false);
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
  const openPortal = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const { url } = await createPortalSession_IO({
        purpose: 'manage',
        locale: locale === 'en' || locale === 'de' ? locale : 'pl',
      });
      if (!alive.current) {
        return;
      }
      if (!url) {
        throw new Error('Missing portal URL');
      }
      window.location.assign(url);
      timeout.current = setTimeout(() => {
        busyRef.current = false;
        setBusy(false);
        setFailed(true);
      }, 4000);
    } catch {
      if (alive.current) {
        busyRef.current = false;
        setBusy(false);
        setFailed(true);
      }
    }
  };
  const payment = user?.stylist_account?.billing?.pendingPayment;
  const validExpiry =
    payment?.expiresAt == null || Date.parse(payment.expiresAt) > Date.now();
  const canResume =
    isError !== true &&
    session?.user.id != null &&
    session.user.id === user?.id &&
    payment != null &&
    validExpiry &&
    isStripeHostedInvoiceUrl(payment.url);
  return (
    <>
      <p role='status'>{t('existingSubscriptionRecovery')}</p>
      {canResume && (
        <ButtonAtom
          variant='outlined'
          onClick={() => void openExternalUrl(payment.url)}>
          {paymentCopy('resume')}
        </ButtonAtom>
      )}
      <ButtonAtom
        variant='outlined'
        onClick={() => void openPortal()}
        disabled={busy}
        loading={busy}>
        {t('manageExistingPlan')}
      </ButtonAtom>
      {failed && <p role='alert'>{t('taxPortalError')}</p>}
    </>
  );
}
