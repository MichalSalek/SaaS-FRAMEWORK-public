// admin/components/UserDetailsDialog.profileTab.molecule.tsx
// Profile tab of the user sheet: the account's facts as a definition list
// (label above the value on a narrow sheet, side by side on a wide one).

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import type { AdminUserRecord } from '../hooks/useAdminUsers';
import { formatDateTimePL } from '../../../../application/date/date.utils';
import {
  adminUserDisplayName,
  adminUserRoleLabelKey,
} from '../AdminUsersPage.helpers';
import styles from './UserDetailsDialog.module.css';

export function ProfileTabMolecule({ user }: { user: AdminUserRecord }) {
  const t = useTranslations('admin.users');
  const stylist = user.stylist_account;
  const roleKey = adminUserRoleLabelKey(user);
  const none = t('noValue');

  const facts: { label: string; value: ReactNode; raw?: boolean }[] = [
    { label: t('detailId'), value: user.id, raw: true },
    {
      label: t('detailName'),
      value: adminUserDisplayName(user.name, t('nameEmpty')),
    },
    { label: t('detailEmail'), value: user.email },
    {
      label: t('detailEmailVerified'),
      value: user.emailVerified ? t('yes') : t('no'),
    },
    {
      label: t('detailAccountType'),
      value: roleKey ? t(roleKey) : user.account_type,
    },
    { label: t('detailActive'), value: user.is_active ? t('yes') : t('no') },
    {
      label: t('detailPlan'),
      value: stylist?.pricing_plan
        ? getPlanDisplayName(stylist.pricing_plan)
        : none,
    },
    { label: t('detailAccountStatus'), value: stylist?.account_status ?? none },
    { label: t('detailPaymentStatus'), value: stylist?.payment_status ?? none },
    {
      label: t('detailTrialEnds'),
      value: formatDateTimePL(stylist?.trial_ends_at ?? null, none),
    },
    {
      label: t('detailCreated'),
      value: formatDateTimePL(user.createdAt, none),
    },
    {
      label: t('detailUpdated'),
      value: formatDateTimePL(user.updatedAt, none),
    },
    { label: t('detailActiveSessions'), value: user._count?.sessions ?? 0 },
  ];

  return (
    <dl className={styles.facts}>
      {facts.map(fact => (
        <div key={fact.label} className={styles.fact}>
          <dt className={styles.factLabel}>{fact.label}</dt>
          <dd
            className={`${styles.factValue}${fact.raw === true ? ` ${styles.factRaw}` : ''}`}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
