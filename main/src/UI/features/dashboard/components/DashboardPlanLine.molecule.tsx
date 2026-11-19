import { useLocale, useTranslations } from 'next-intl';
import { CreditCardIcon } from '@phosphor-icons/react';
import { buildAccountSectionHref } from '../../../../application/policies/account-sections.config';
import { NavRowMolecule } from '../../../components/NavRow/NavRow.molecule';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { resolveDashboardPlanLine } from '../dashboard-plan.helpers';

/** Mounted exclusively by the resolved stylist dashboard, never the role shell. */
export function DashboardPlanLineMolecule() {
  const t = useTranslations('dashboard.stylist.plan');
  const tButtons = useTranslations('buttons');
  const locale = useLocale();
  const query = useCurrentUserAccount();
  if (query.isLoading) {
    return <SkeletonAtom variant='text' width='100%' height={44} />;
  }
  if (query.isError) {
    return (
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const account = query.data?.stylist_account;
  if (!account) {
    return null;
  }
  const line = resolveDashboardPlanLine(account, locale);
  return (
    <NavRowMolecule
      href={buildAccountSectionHref('plan')}
      icon={<CreditCardIcon />}
      label={t(line.key, line.values)}
      density='compact'
      trailing='disc'
    />
  );
}
