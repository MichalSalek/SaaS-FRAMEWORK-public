// UI/features/admin/AdminAuditPage.parts.organism.tsx
// The audit list on the shared table (a real table from 768px of its own
// width, a card per entry below) and the details of one entry in a side sheet.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheckIcon } from '@phosphor-icons/react';
import { formatTimestampPL } from '../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
  type DataTableError,
} from '../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { AppSheetAtom } from '../../primitives/AppSheet.atom';
import type { AuditTrailEntry } from './hooks/useAdminAuditTrail';
import {
  PAGE_SIZE,
  deriveSeverity,
  describeAdminEvent,
  getSeverityColor,
  isNamespaceKey,
  NAMESPACE_LABEL_KEY,
  SEVERITY_LABEL_KEY,
} from './AdminAuditPage.helpers';
import styles from './AdminAuditPage.module.css';

type AuditT = ReturnType<typeof useTranslations<'admin.audit'>>;

const namespaceLabel = (namespace: string, t: AuditT): string =>
  isNamespaceKey(namespace) ? t(NAMESPACE_LABEL_KEY[namespace]) : namespace;

function AuditSeverityPillAtom({ namespace }: { namespace: string }) {
  const t = useTranslations('admin.audit');
  const severity = deriveSeverity(namespace);
  return (
    <StatusPillAtom
      color={getSeverityColor(severity)}
      label={t(SEVERITY_LABEL_KEY[severity])}
      emphasis={severity === 'critical' ? 'solid' : 'tint'}
      showDot={severity !== 'critical'}
    />
  );
}

/* ─── Table ─── */
// DECISION (nie usuwaj tego komentarza) — S126: wiersz nie rozwija się już w
// miejscu. Rozwinięcie przesuwało wszystko pod sobą, a na telefonie dokładało
// drugą kartę w karcie; szczegóły wpisu otwiera teraz cały wiersz, w arkuszu
// (ten sam wzór co szczegóły logu). Lista pokazuje etykietę typu, surowy kod
// przestrzeni nazw stoi w szczegółach.
export function AuditTableOrganism({
  entries,
  state,
  error,
  isSearching,
  onOpen,
  footer,
}: {
  entries: readonly AuditTrailEntry[];
  state: 'ready' | 'loading' | 'empty' | 'error';
  error: DataTableError;
  /** The empty list is the answer to a search, not an empty log. */
  isSearching: boolean;
  onOpen: (entry: AuditTrailEntry) => void;
  footer: ReactNode;
}) {
  const t = useTranslations('admin.audit');

  const columns: DataTableColumn<AuditTrailEntry>[] = [
    {
      id: 'event',
      header: t('columnEvent'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: entry => {
        const sentence = describeAdminEvent(entry.event_name);
        return sentence === null ? (
          <code className={styles.eventCode}>{entry.event_name}</code>
        ) : (
          <>
            {sentence}
            <code className={`${styles.eventCode} ${styles.cellQuiet}`}>
              {entry.event_name}
            </code>
          </>
        );
      },
    },
    {
      id: 'admin',
      header: t('columnAdmin'),
      priority: 'secondary',
      cell: entry => entry.admin_name || entry.admin_email || t('noValue'),
    },
    {
      id: 'type',
      header: t('columnType'),
      priority: 'meta',
      // Fits the longest label („Administracja”, „Administration”).
      width: '8.5rem',
      cell: entry => namespaceLabel(entry.namespace, t),
    },
    {
      id: 'severity',
      header: t('columnSeverity'),
      priority: 'meta',
      width: '8rem',
      cell: entry => <AuditSeverityPillAtom namespace={entry.namespace} />,
    },
    {
      id: 'time',
      header: t('columnTimestamp'),
      priority: 'meta',
      width: '9.5rem',
      cell: entry => (
        <span className={styles.nowrap}>
          {formatTimestampPL(entry.created_at)}
        </span>
      ),
    },
  ];

  return (
    <DataTableOrganism
      caption={t('pageTitle')}
      columns={columns}
      rows={entries}
      rowKey={entry => entry.id}
      rowLabel={() => t('openEntryAria')}
      onRowClick={onOpen}
      state={state}
      error={error}
      skeletonRows={PAGE_SIZE}
      empty={
        <EmptyStateAtom
          icon={<ShieldCheckIcon size={28} />}
          titleAs='h2'
          title={isSearching ? t('emptySearch') : t('emptyEntries')}
          description={
            isSearching ? t('emptySearchHint') : t('emptyEntriesHint')
          }
        />
      }
      footer={footer}
    />
  );
}

/* ─── Details of one entry ─── */
export function AuditDetailsSheetOrganism({
  entry,
  onClose,
}: {
  entry: AuditTrailEntry;
  onClose: () => void;
}) {
  const t = useTranslations('admin.audit');
  const facts: { label: string; value: ReactNode; raw?: boolean }[] = [
    { label: t('columnEvent'), value: entry.event_name, raw: true },
    {
      label: t('columnType'),
      value: `${namespaceLabel(entry.namespace, t)} (${entry.namespace})`,
    },
    { label: t('columnAdmin'), value: entry.admin_name || t('noValue') },
    {
      label: t('detailAdminEmail'),
      value: entry.admin_email ?? t('noValue'),
    },
    {
      label: t('detailAdminId'),
      value: entry.admin_user_id ?? t('noValue'),
      raw: entry.admin_user_id !== null,
    },
    {
      label: t('detailTarget'),
      value: entry.target_info ?? t('noValue'),
      raw: entry.target_info !== null,
    },
    { label: t('detailDetails'), value: entry.details, raw: true },
  ];

  return (
    <AppSheetAtom
      open
      side='left'
      size='wide'
      title={describeAdminEvent(entry.event_name) ?? entry.event_name}
      description={formatTimestampPL(entry.created_at)}
      closeLabel={t('sheetClose')}
      headerExtra={<AuditSeverityPillAtom namespace={entry.namespace} />}
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}>
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
    </AppSheetAtom>
  );
}
