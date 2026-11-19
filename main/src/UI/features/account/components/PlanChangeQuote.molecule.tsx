import { formatMoney } from '@kernel/domain/pricing/money.format';
import { useTranslations } from 'next-intl';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { buildAccountSectionHref } from '../../../../application/policies/account-sections.config';
import { formatDateLong } from '../../../../application/date/date.utils';
import type { PlanChangePreview } from '../hooks/usePlanChangePreview';
import styles from './PlanChangeQuote.module.css';

export function PlanChangeQuoteMolecule({
  preview,
  rejected = false,
}: {
  preview: PlanChangePreview;
  rejected?: boolean;
}) {
  const t = useTranslations('account.pay.changeConfirmation');
  const locale = useCurrentLang();
  if (preview.isFetching) {
    return <p role='status'>{t('loading')}</p>;
  }
  if (preview.isError || !preview.data || preview.expired || rejected) {
    return (
      <div className={styles.stack}>
        <p role='alert'>
          {t(
            preview.canceling
              ? 'resumeBeforeCycle'
              : rejected
                ? 'changeFailed'
                : preview.expired
                  ? 'expired'
                  : 'unavailable'
          )}
        </p>
        {preview.canceling ? (
          <LinkButtonAtom
            href={buildAccountSectionHref('plan')}
            variant='outlined'>
            {t('openPlanManagement')}
          </LinkButtonAtom>
        ) : (
          <ButtonAtom variant='outlined' onClick={() => void preview.refetch()}>
            {t('retry')}
          </ButtonAtom>
        )}
      </div>
    );
  }
  const quote = preview.data;
  const money = (value: number) =>
    formatMoney(value, quote.currency, locale).replaceAll(' ', '\u00a0');
  const date = (value: string) =>
    formatDateLong(value, locale).replaceAll(' ', '\u00a0');
  return (
    <div className={styles.stack}>
      <p>{t(quote.billingPeriod === 'month' ? 'monthly' : 'yearly')}</p>
      <dl className={styles.figures}>
        <div className={styles.row}>
          <dt>{t('amountDue')}</dt>
          <dd className={styles.amount}>{money(quote.amountDue)}</dd>
        </div>
        {quote.total !== quote.amountDue && (
          <div className={styles.row}>
            <dt>{t('settlementTotal')}</dt>
            <dd>{money(quote.total)}</dd>
          </div>
        )}
        {quote.taxAmount !== null && (
          <div className={styles.row}>
            <dt>{t('tax')}</dt>
            <dd>{money(quote.taxAmount)}</dd>
          </div>
        )}
      </dl>
      {quote.regularAmount != null && (
        <p>
          {t(
            quote.billingPeriod === 'month'
              ? 'regularMonthly'
              : 'regularYearly',
            {
              amount: money(quote.regularAmount),
            }
          )}
        </p>
      )}
      {quote.nextBillingAt != null && (
        <p>{t('nextBilling', { date: date(quote.nextBillingAt) })}</p>
      )}
      {quote.total < 0 && <p>{t('credit')}</p>}
      {quote.trialEndsAt != null &&
        new Date(quote.trialEndsAt).getTime() > Date.now() && (
          <p>{t('trial', { date: date(quote.trialEndsAt) })}</p>
        )}
      {quote.cancelAt !== null && (
        <p>{t('canceling', { date: date(quote.cancelAt) })}</p>
      )}
      <p className={styles.validity}>
        {t('validUntil', {
          time: new Intl.DateTimeFormat(locale, {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(quote.expiresAt)),
        })}
      </p>
    </div>
  );
}
