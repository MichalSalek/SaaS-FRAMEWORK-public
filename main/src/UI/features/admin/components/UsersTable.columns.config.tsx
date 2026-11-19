// admin/components/UsersTable.columns.config.tsx
// Column definitions of the users table. The person is always shown; every
// other column is switchable („Kolumny” menu, kept per device). The default
// set is the list as it was plus the works count; the analysis figures
// (AdminUserListStats, kernel admin-users.dto.ts) are opt-in.

import type { ReactNode } from 'react';
import type { useTranslations } from 'next-intl';
import type { AdminUserRecord } from '../hooks/useAdminUsers';
import { getPlanClass, getStatusInfo } from './UsersTable.helpers';
import type { AdminUserStatusKey } from './UsersTable.helpers';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import { formatDateShortPL } from '../../../../application/date/date.utils';
import {
  SORTABLE_KEYS,
  adminUserDisplayName,
  adminUserRoleLabelKey,
} from '../AdminUsersPage.helpers';
import type { DataTableColumn } from '../../../components/DataTable/DataTable.organism';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import { SoftBreakTextAtom } from '../../../components/SoftBreakText/SoftBreakText.atom';
import styles from '../AdminUsersPage.module.css';

type T = ReturnType<typeof useTranslations<'admin.users'>>;
/** A cell of the CSV export: plain text, a number, or empty. */
export type UsersCsvValue = string | number | null;

/** A users-table column plus its value in the CSV export (UsersCsvExport.helpers.ts). */
export type UsersTableColumn = DataTableColumn<AdminUserRecord> & {
  csv: (user: AdminUserRecord) => UsersCsvValue;
};
type Column = UsersTableColumn;

/** Stable storage id of this table's column choice. */
export const USERS_TABLE_ID = 'admin-users';

const NUMBER_TRACK = '6.5rem';

export function buildUsersTableColumns(t: T, locale: string): Column[] {
  const numbers = new Intl.NumberFormat(locale);
  const none = t('noValue');
  const statusLabel: Record<AdminUserStatusKey, string> = {
    Disabled: t('statusDisabled'),
    Trial: t('statusTrial'),
    Active: t('statusActive'),
  };
  const count = (value: number | null): ReactNode =>
    value === null ? (
      none
    ) : (
      <span className={styles.count}>{numbers.format(value)}</span>
    );
  const date = (value: Date | string | null | undefined): string =>
    formatDateShortPL(value ?? null, none);
  // DECISION: the export writes dates as full ISO 8601 in UTC, not the table's short Polish date:
  // the file is sorted and filtered in a spreadsheet, and a day without the time loses the order of
  // sign-ins on the same day. Empty cell for no date.
  const isoDate = (value: Date | string | null | undefined): string | null => {
    const time =
      value === null || value === undefined ? NaN : new Date(value).getTime();
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  };
  const yesNo = (value: boolean | null): string | null =>
    value === null ? null : value ? t('yes') : t('no');
  const roleLabel = (user: AdminUserRecord): string => {
    const roleKey = adminUserRoleLabelKey(user);
    return roleKey ? t(roleKey) : user.account_type;
  };
  const paymentLabel = (user: AdminUserRecord): string | null => {
    const payment = user.stylist_account?.payment_status ?? null;
    return payment === null ? null : t(`paymentStatusLabel.${payment}`);
  };
  const teamLabel = (user: AdminUserRecord): string | null =>
    user.stats.team_role === 'OWNER'
      ? t('teamOwner')
      : user.stats.team_role === 'MEMBER'
        ? t('teamMember')
        : null;

  /** A switchable figure: right-aligned, labelled in the card, off by default. */
  const figure = (
    id: string,
    header: string,
    read: (user: AdminUserRecord) => number | null
  ): Column => ({
    id,
    header,
    priority: 'meta',
    width: NUMBER_TRACK,
    align: 'end',
    labelInCard: true,
    optional: true,
    cell: user => count(read(user)),
    csv: read,
  });
  /** A switchable fact shown as a word or a date, off by default. */
  const fact = (
    id: string,
    header: string,
    width: string,
    csv: (user: AdminUserRecord) => UsersCsvValue,
    cell: (user: AdminUserRecord) => ReactNode = user => csv(user) ?? none
  ): Column => ({
    id,
    header,
    priority: 'meta',
    width,
    labelInCard: true,
    optional: true,
    cell,
    csv,
  });

  return [
    {
      id: 'name',
      header: t('columnName'),
      priority: 'primary',
      width: 'minmax(0, 1.2fr)',
      sortable: SORTABLE_KEYS.has('name'),
      cell: user => adminUserDisplayName(user.name, t('nameEmpty')),
      // The file leaves a nameless person's cell empty (the table shows a placeholder).
      csv: user => user.name?.trim() || null,
    },
    {
      id: 'email',
      header: t('columnEmail'),
      priority: 'secondary',
      width: 'minmax(0, 1.5fr)',
      sortable: SORTABLE_KEYS.has('email'),
      optional: true,
      defaultVisible: true,
      cell: user => <SoftBreakTextAtom>{user.email}</SoftBreakTextAtom>,
      csv: user => user.email,
    },
    {
      id: 'role',
      header: t('columnRole'),
      priority: 'meta',
      width: '8rem',
      optional: true,
      defaultVisible: true,
      cell: roleLabel,
      csv: roleLabel,
    },
    {
      id: 'plan',
      header: t('columnPlan'),
      priority: 'meta',
      width: '5.5rem',
      optional: true,
      defaultVisible: true,
      cell: user => {
        const plan = user.stylist_account?.pricing_plan ?? null;
        return plan ? (
          <span className={`${styles.planBadge} ${getPlanClass(plan)}`}>
            {getPlanDisplayName(plan)}
          </span>
        ) : null;
      },
      csv: user => {
        const plan = user.stylist_account?.pricing_plan ?? null;
        return plan ? getPlanDisplayName(plan) : null;
      },
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'meta',
      width: '7rem',
      optional: true,
      defaultVisible: true,
      cell: user => {
        const status = getStatusInfo(user);
        return (
          <StatusPillAtom
            color={status.color}
            label={statusLabel[status.label]}
          />
        );
      },
      csv: user => statusLabel[getStatusInfo(user).label],
    },
    {
      id: 'createdAt',
      header: t('columnCreated'),
      priority: 'meta',
      width: '7rem',
      labelInCard: true,
      sortable: SORTABLE_KEYS.has('createdAt'),
      optional: true,
      defaultVisible: true,
      cell: user => date(user.createdAt),
      csv: user => isoDate(user.createdAt),
    },
    {
      ...figure('photos', t('columnPhotos'), user => user.stats.photos),
      sortable: SORTABLE_KEYS.has('photos'),
      defaultVisible: true,
    },
    {
      ...fact(
        'lastLogin',
        t('columnLastLogin'),
        '7.5rem',
        user => isoDate(user.last_login_at),
        user => date(user.last_login_at)
      ),
      sortable: SORTABLE_KEYS.has('lastLogin'),
    },
    figure(
      'publicWorks',
      t('columnPublicWorks'),
      user => user.stats.public_works
    ),
    figure(
      'connections',
      t('columnConnections'),
      user => user.stats.connections
    ),
    figure(
      'inspirationSessions',
      t('columnInspirationSessions'),
      user => user.stats.inspiration_sessions
    ),
    figure(
      'messagesSent',
      t('columnMessagesSent'),
      user => user.stats.messages_sent
    ),
    figure(
      'supportThreads',
      t('columnSupportThreads'),
      user => user.stats.support_threads
    ),
    figure(
      'signedInDevices',
      t('columnSignedInDevices'),
      user => user._count.sessions
    ),
    figure(
      'pushDevices',
      t('columnPushDevices'),
      user => user.stats.push_devices
    ),
    {
      ...fact('city', t('columnCity'), '8rem', user => user.stats.city),
      sortable: SORTABLE_KEYS.has('city'),
    },
    fact('team', t('columnTeam'), '8.5rem', teamLabel),
    fact('payment', t('columnPayment'), '7rem', paymentLabel),
    fact(
      'trialEnds',
      t('columnTrialEnds'),
      '7.5rem',
      user => isoDate(user.stylist_account?.trial_ends_at),
      user => date(user.stylist_account?.trial_ends_at)
    ),
    fact('emailVerified', t('columnEmailVerified'), '7rem', user =>
      yesNo(user.emailVerified)
    ),
    fact('notifications', t('columnNotifications'), '7rem', user =>
      yesNo(user.stats.notifications_enabled)
    ),
    fact('marketing', t('columnMarketing'), '7rem', user =>
      yesNo(user.stats.email_marketing)
    ),
  ];
}
