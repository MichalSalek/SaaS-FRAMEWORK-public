// UI/features/admin/AdminLogGroups.organism.tsx
// Widok klas błędów: jeden wiersz na odcisk palca, na wspólnej tabeli (od
// 768px własnej szerokości tabela, węziej karta na grupę). Wiadomość stoi
// pierwsza i nigdy nie jest ucinana; wiersz otwiera szczegóły wpisu.

import { useTranslations } from 'next-intl';
import {
  LOG_APPLICATIONS,
  isLogIssueNeedingReaction,
} from '@kernel/domain/admin/log-triage.config';
import type { LogIssueGroup } from '@kernel/models/admin/admin-logs.dto';
import { formatTimestampPL } from '../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import {
  LogMessageMolecule,
  LogNamespaceMolecule,
  TypeBadgeMolecule,
} from './AdminLogsPage.parts.molecule';
import styles from './AdminLogsPage.module.css';

// Kolumna `application` jest w bazie zwykłym tekstem, więc historyczny rekord może
// nieść wartość spoza dzisiejszej listy — wtedy pokazujemy ją surową, zamiast
// wyświetlić klucz tłumaczenia.
const applicationLabel = (
  application: string,
  t: (key: string) => string
): string =>
  (LOG_APPLICATIONS as readonly string[]).includes(application)
    ? t(`application_${application}`)
    : application;

type GroupsProps = {
  groups: readonly LogIssueGroup[];
  isLoading: boolean;
  /** Agregacja zwraca ograniczoną liczbę grup — informujemy, że lista jest ucięta. */
  truncatedInfo: { shown: number; total: number } | null;
  onOpenLog: (id: string) => void;
  /** Accessible name of the table; defaults to the view name. */
  caption?: string;
  /** Text of the empty list; defaults to „no groups match the filters". */
  emptyLabel?: string;
};

export function AdminLogGroupsOrganism({
  groups,
  isLoading,
  truncatedInfo,
  onOpenLog,
  caption,
  emptyLabel,
}: GroupsProps) {
  const t = useTranslations('admin.logs');

  // DECISION (nie usuwaj tego komentarza) — S126: status grupy to JEDNO słowo
  // w wierszu (czerwone tylko tam, gdzie czeka reakcja), a nadawanie statusu z
  // notatką mieszka w szczegółach wpisu (wiersz je otwiera, sekcja „Grupa”).
  // Wcześniej to samo dało się zrobić w dwóch miejscach: w rozwijanym panelu
  // pod wierszem i w szczegółach; panel w wierszu wymagał osobnego przycisku w
  // komórce i nie mieścił się w karcie na telefonie.
  const columns: DataTableColumn<LogIssueGroup>[] = [
    {
      id: 'message',
      header: t('columnMessage'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: group => (
        <>
          <LogMessageMolecule text={group.sample_message} />
          {group.note ? (
            <span className={styles.cellQuiet}>{group.note}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'namespace',
      header: t('columnNamespace'),
      priority: 'secondary',
      cell: group => (
        <>
          <LogNamespaceMolecule value={group.namespace} />
          <span className={styles.cellQuiet}>
            {applicationLabel(group.application, t)}
          </span>
        </>
      ),
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'meta',
      // Fits the longest status word („naprawiony”, „ignorowany”).
      width: '7rem',
      cell: group => (
        <span
          className={styles.statusWord}
          data-action={isLogIssueNeedingReaction(group.status)}>
          {t(`status_${group.status}`)}
        </span>
      ),
    },
    {
      id: 'type',
      header: t('columnType'),
      priority: 'meta',
      // Fits the longest type pill (icon + „ostrzeżenie” / „Information”).
      width: '9rem',
      cell: group => <TypeBadgeMolecule type={group.type} />,
    },
    {
      id: 'count',
      header: t('columnOccurrences'),
      priority: 'meta',
      align: 'end',
      width: '6rem',
      labelInCard: true,
      cell: group => group.count.toLocaleString('pl-PL'),
    },
    {
      id: 'lastSeen',
      header: t('columnLastSeen'),
      priority: 'meta',
      width: '9.5rem',
      labelInCard: true,
      cell: group => (
        <span className={styles.nowrap}>
          {formatTimestampPL(group.last_seen)}
        </span>
      ),
    },
  ];

  return (
    <DataTableOrganism
      caption={caption ?? t('viewGroups')}
      columns={columns}
      rows={groups}
      rowKey={group => group.fingerprint}
      rowLabel={() => t('openLogAria')}
      onRowClick={group => onOpenLog(group.sample_id)}
      state={isLoading ? 'loading' : groups.length === 0 ? 'empty' : 'ready'}
      empty={emptyLabel ?? t('noGroups')}
      {...(truncatedInfo !== null && {
        footer: (
          <p className={styles.listNote}>
            {t('groupsTruncated', truncatedInfo)}
          </p>
        ),
      })}
    />
  );
}
