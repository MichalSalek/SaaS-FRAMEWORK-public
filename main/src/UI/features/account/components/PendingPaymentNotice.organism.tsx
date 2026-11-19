import { authClient } from '../../../../application/auth/better-auth-client';
import { useKnownPendingPayment } from '../hooks/useKnownPendingPayment';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useId, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isStripeHostedInvoiceUrl } from '@kernel/domain/stripe/hosted-invoice-url';
import {
  CardMolecule,
  CardContentAtom,
} from '../../../components/Card/Card.molecule';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { openExternalUrl } from '../../../../application/platform/browser';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { formatPlanCharge } from '../AccountPlan.helpers';
import { usePendingPaymentRefresh } from '../hooks/usePendingPaymentRefresh';
import styles from './PendingPaymentNotice.module.css';

export function PendingPaymentNoticeOrganism({
  visible,
}: {
  visible: boolean;
}) {
  const { data, refetch, isError } = useCurrentUserAccount();
  const { data: session } = authClient.useSession();
  const actorId = session?.user.id;
  const canShow = visible && actorId !== undefined && actorId === data?.id;
  const account = data?.stylist_account;
  const known =
    !isError &&
    (account?.billing != null ||
      account?.subscription_status == null ||
      ['CANCELED', 'INCOMPLETE_EXPIRED', 'UNPAID', 'PAUSED'].includes(
        account.subscription_status
      ));
  const payment = useKnownPendingPayment(
    actorId,
    account?.billing?.pendingPayment,
    known,
    canShow
  );
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const checkManually = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };
  const t = useTranslations('layout.pendingPayment');
  const lang = useCurrentLang();
  const titleId = useId();
  const expired = usePendingPaymentRefresh(payment, onRefresh, canShow);
  if (!payment || !isStripeHostedInvoiceUrl(payment.url)) {
    return null;
  }
  const amount = formatPlanCharge(
    payment.amountRemaining,
    payment.currency,
    lang
  );
  if (amount === null) {
    return null;
  }
  return (
    <section className={styles.notice} aria-labelledby={titleId}>
      <CardMolecule>
        <CardContentAtom>
          <div className={styles.content}>
            <h2 id={titleId} className={styles.title}>
              {t('title')}
            </h2>
            <p role='status'>
              {expired
                ? t('expired')
                : !known
                  ? t('unavailable')
                  : t(payment.reason, { amount })}
            </p>
            <div className={styles.actions}>
              {/* The private invoice capability stays out of DOM href/autocapture. */}
              {!expired && (
                <ButtonAtom
                  variant='outlined'
                  onClick={() => void openExternalUrl(payment.url)}>
                  {t('resume')}
                </ButtonAtom>
              )}
              <ButtonAtom
                variant='ghost'
                loading={refreshing}
                onClick={() => void checkManually()}>
                {t('refresh')}
              </ButtonAtom>
            </div>
          </div>
        </CardContentAtom>
      </CardMolecule>
    </section>
  );
}
