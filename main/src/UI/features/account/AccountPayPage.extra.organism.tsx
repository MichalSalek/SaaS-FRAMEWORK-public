import { TypographyAtom } from '../../components/Typography/Typography.atom';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { buildAccountSectionHref } from '../../../application/policies/account-sections.config';
import { useTranslations } from 'next-intl';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './AccountPayPage.module.css';

export function PayChangeReturnNoticeOrganism({
  href,
}: {
  href: string | null;
}) {
  const t = useTranslations('account.pay');
  if (href === null) {
    return null;
  }
  return (
    <section role='status'>
      <p>{t('changeSummaryUnavailable')}</p>
      <LinkButtonAtom href={href} variant='primary'>
        {t('openChangeSummary')}
      </LinkButtonAtom>
    </section>
  );
}

export function PayLoadingSkeletonOrganism() {
  return (
    <div className={styles.page} aria-busy='true'>
      <SkeletonAtom variant='rect' width='100%' height={72} />
      <SkeletonAtom variant='rect' width='100%' height={108} />
      <div className={styles.plansList}>
        {[0, 1, 2, 3].map(i => (
          <SkeletonAtom key={i} variant='rect' width='100%' height={380} />
        ))}
      </div>
    </div>
  );
}

export function BillingDetailsSectionOrganism({
  profile,
  isError,
  onOpen,
  isOpening,
}: {
  profile: BillingProfile | undefined;
  isError: boolean;
  onOpen: () => void;
  isOpening: boolean;
}) {
  const t = useTranslations('account.pay');
  return (
    <section>
      <h2 className={styles.sectionTitle}>{t('billingDetailsTitle')}</h2>
      {isError ? (
        <p role='status'>{t('billingDetailsError')}</p>
      ) : profile && !profile.has_company_details ? (
        <p>{t('billingDetailsMissing')}</p>
      ) : null}
      <ButtonAtom
        variant='outlined'
        onClick={onOpen}
        disabled={isOpening}
        loading={isOpening}>
        {t('billingDetailsAction')}
      </ButtonAtom>
    </section>
  );
}

export function PayHeroOrganism({
  title,
  meta,
  pastDue,
}: {
  title: string;
  meta: string | null;
  pastDue: boolean;
}) {
  const t = useTranslations('account.pay');
  return (
    <>
      <AppHeroOrganism title={title} {...(meta !== null && { meta })} />
      <LinkButtonAtom
        href={buildAccountSectionHref('plan')}
        variant={pastDue ? 'primary' : 'outlined'}>
        {t('planHubLink')}
      </LinkButtonAtom>
    </>
  );
}

export function PayPriceNoticeOrganism({
  unavailable,
  country,
}: {
  unavailable?: boolean;
  country?: CountryCode | null;
}) {
  const t = useTranslations('account.pay');
  const tax = useTranslations('static.pricing.tierSection');
  return (
    <>
      {unavailable && (
        <p className={styles.pricesUnavailableHint} role='status'>
          {t('pricesUnavailableHint')}
        </p>
      )}
      {country === 'PL' && (
        <TypographyAtom variant='body2' as='p' align='center'>
          {tax('vatNote')}
        </TypographyAtom>
      )}
    </>
  );
}
