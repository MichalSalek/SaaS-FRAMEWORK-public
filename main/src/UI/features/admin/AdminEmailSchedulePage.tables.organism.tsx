// UI/features/admin/AdminEmailSchedulePage.tables.organism.tsx
// The two rule lists of the email schedule page (trial and cancel sequence),
// each the shared admin panel (title, count) around the shared DataTable.
//
// DECISION (nie usuwaj tego komentarza) — S126: wiersz mówi każdy fakt RAZ.
// Wcześniej pod etykietą warunku, kategorii i ujęcia stał jeszcze surowy klucz
// (ANY, TRIAL_SEQUENCE, „Reciprocity”), czyli to samo drugi raz w innym
// języku, a kolumna „#” tylko numerowała wiersze, których kolejność niesie
// dzień. Zostaje jeden surowy identyfikator: nazwa zdarzenia, bo po niej
// szuka się w logach.

import type { useTranslations } from 'next-intl';
import { EMAIL_CATEGORY } from '@kernel/domain/email/email-schedule.config';
import type {
  TrialEmailRule,
  CancelEmailRule,
} from '@kernel/domain/email/email-schedule.types';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import {
  CATEGORY_LABEL_KEY,
  CONDITION_LABEL_KEY,
  ConditionBadgeMolecule,
  EventLabelMolecule,
  framingLabelKey,
} from './AdminEmailSchedulePage.labels.molecule';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import styles from './AdminEmailSchedulePage.module.css';

type ScheduleT = ReturnType<typeof useTranslations<'admin.emailSchedule'>>;

type RuleListProps<T> = {
  rows: readonly T[] | null;
  isLoading: boolean;
  t: ScheduleT;
};

/** „D+3”: days after the trigger; one piece, never breaks inside. */
const dayOffset = (triggerDay: number) => (
  <span className={styles.nowrap}>D+{triggerDay}</span>
);

const listState = (rows: readonly unknown[] | null, isLoading: boolean) =>
  isLoading
    ? 'loading'
    : rows === null || rows.length === 0
      ? 'empty'
      : 'ready';

/* ─── Trial sequence ─── */

export function TrialTableOrganism({
  rows,
  isLoading,
  t,
}: RuleListProps<TrialEmailRule>) {
  const columns: DataTableColumn<TrialEmailRule>[] = [
    {
      id: 'event',
      header: t('columnEvent'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: row => <EventLabelMolecule name={row.infoEvent} />,
    },
    {
      id: 'day',
      header: t('columnDay'),
      priority: 'meta',
      width: '4.5rem',
      labelInCard: true,
      cell: row => dayOffset(row.triggerDay),
    },
    {
      id: 'condition',
      header: t('columnCondition'),
      priority: 'meta',
      // Fits the longest condition pill („Nieaktywna”, „Inaktiv”).
      width: '8rem',
      cell: row => (
        <ConditionBadgeMolecule
          condition={row.condition}
          label={t(CONDITION_LABEL_KEY[row.condition])}
        />
      ),
    },
    {
      id: 'category',
      header: t('columnCategory'),
      priority: 'meta',
      width: '7rem',
      // The panel's title already says „Sekwencja trialu”: only a rule of
      // ANOTHER category (the win-back, marketing) names its own.
      cell: row =>
        row.category === EMAIL_CATEGORY.TRIAL_SEQUENCE
          ? null
          : t(CATEGORY_LABEL_KEY[row.category]),
    },
    {
      id: 'framing',
      header: t('columnFraming'),
      priority: 'secondary',
      width: 'minmax(0, 1.5fr)',
      cell: row => {
        const framingKey = framingLabelKey(row.id);
        return framingKey ? t(framingKey) : row.framing;
      },
    },
  ];

  return (
    <AdminPanelMolecule
      title={t('trialSequence')}
      // Always mounted: the count arriving moves nothing.
      aside={rows !== null ? t('emailCount', { count: rows.length }) : null}>
      <DataTableOrganism
        surface='flush'
        caption={t('trialSequence')}
        columns={columns}
        rows={rows ?? []}
        rowKey={row => row.id}
        state={listState(rows, isLoading)}
        empty={t('noTrialEmails')}
      />
    </AdminPanelMolecule>
  );
}

/* ─── Cancel sequence ─── */

export function CancelTableOrganism({
  rows,
  isLoading,
  t,
}: RuleListProps<CancelEmailRule>) {
  const columns: DataTableColumn<CancelEmailRule>[] = [
    {
      id: 'event',
      header: t('columnEvent'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: row => <EventLabelMolecule name={row.infoEvent} />,
    },
    {
      id: 'day',
      header: t('columnDay'),
      priority: 'meta',
      width: '4.5rem',
      labelInCard: true,
      cell: row => dayOffset(row.triggerDay),
    },
    {
      id: 'category',
      header: t('columnCategory'),
      priority: 'meta',
      width: '9rem',
      cell: row => t(CATEGORY_LABEL_KEY[row.category]),
    },
  ];

  return (
    <AdminPanelMolecule
      title={t('cancelSequence')}
      // Always mounted: the count arriving moves nothing.
      aside={rows !== null ? t('emailCount', { count: rows.length }) : null}>
      <DataTableOrganism
        surface='flush'
        caption={t('cancelSequence')}
        columns={columns}
        rows={rows ?? []}
        rowKey={row => row.id}
        state={listState(rows, isLoading)}
        skeletonRows={3}
        empty={t('noCancelEmails')}
      />
    </AdminPanelMolecule>
  );
}
