// admin/components/LogDetailsBody.organism.tsx
// The content of one log entry's detail (message, context, payload, metadata,
// group triage, request chain) without a container: LogDetailsSheet wraps it
// in the side sheet.

import { AppLinkAtom as Link } from '../../../components/AppLink/AppLink.atom';
import { useLocale, useTranslations } from 'next-intl';
import type { EventLogRecordFromDB } from '@kernel/models/admin/admin.dto';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { formatTimestamp } from '../../../../application/date/date.utils';
import { copyText } from '../../../../application/platform/clipboard';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { LogIssueStatusEditorMolecule } from '../LogIssueStatusEditor.molecule';
import type { useAdminLogDetails } from '../hooks/useAdminLogDetails';
import { useSetLogIssueStatus } from '../hooks/useSetLogIssueStatus';
import styles from './LogDetailsSheet.module.css';
import { adminUserHref } from '@kernel/domain/admin/admin-users-url.config';

const pretty = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
};

const callstackOf = (raw: string): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'callstack' in parsed &&
      Array.isArray((parsed as { callstack: unknown }).callstack)
    ) {
      return (parsed as { callstack: unknown[] }).callstack.filter(
        (line): line is string => typeof line === 'string'
      );
    }
  } catch {
    return null;
  }
  return null;
};

function ContextRow({ label, children }: { label: string; children: string }) {
  return (
    <>
      <span className={styles.detailLabel}>{label}</span>
      <p className={styles.detailValue}>{children}</p>
    </>
  );
}

function JsonBlock({
  title,
  raw,
  copyLabel,
  emptyLabel,
  onCopy,
}: {
  title: string;
  raw: string;
  copyLabel: string;
  emptyLabel: string;
  onCopy: (text: string) => void;
}) {
  const text = pretty(raw);
  const stack = callstackOf(raw);
  return (
    <section>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {text.length === 0 ? (
        <p className={styles.muted}>{emptyLabel}</p>
      ) : (
        <div className={styles.block}>
          {stack && stack.length > 0 ? (
            <ol className={styles.stack}>
              {stack.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : null}
          <pre className={styles.pre}>{text}</pre>
          <ButtonAtom size='sm' variant='ghost' onClick={() => onCopy(text)}>
            {copyLabel}
          </ButtonAtom>
        </div>
      )}
    </section>
  );
}

function OccurrenceButton({
  record,
  label,
  onOpen,
}: {
  record: EventLogRecordFromDB;
  label: string;
  onOpen: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <li>
      <button
        type='button'
        className={styles.occurrenceButton}
        aria-label={label}
        onClick={() => onOpen(record.id)}>
        <span>{record.message}</span>
        <span className={styles.occurrenceMeta}>
          {formatTimestamp(record.created_at, locale)}, {record.namespace}
        </span>
      </button>
    </li>
  );
}

export function useCopyWithToast() {
  const t = useTranslations('admin.logs');
  return async (text: string) => {
    const ok = await copyText(text);
    pushNewSnackbar(
      ok ? t('copySuccess') : t('copyError'),
      ok ? 'success' : 'error'
    );
  };
}

/**
 * Everything the detail of one log entry shows, without the sheet around it:
 * LogDetailsSheet renders it. `details` is the caller's query, so the entry is
 * read once.
 */
export function LogDetailsBodyOrganism({
  details,
  onOpenLog,
}: {
  details: ReturnType<typeof useAdminLogDetails>;
  onOpenLog: (id: string) => void;
}) {
  const t = useTranslations('admin.logs');
  const locale = useLocale();
  const setStatus = useSetLogIssueStatus();
  const copy = useCopyWithToast();
  const record = details.data?.record;
  const group = details.data?.group ?? null;

  return details.isLoading ? (
    <p className={styles.muted}>{t('detailsLoading')}</p>
  ) : !record || !details.data ? (
    <ErrorStateMolecule
      message={t('detailsLoadError')}
      {...(details.isError && {
        retryLabel: t('retry'),
        onRetry: () => void details.refetch(),
        isRetrying: details.isFetching,
      })}
    />
  ) : (
    <div className={styles.sections}>
      <section>
        <h3 className={styles.sectionTitle}>{t('sectionMessage')}</h3>
        <p className={styles.message}>{record.message}</p>
      </section>

      <section>
        <h3 className={styles.sectionTitle}>{t('sectionContext')}</h3>
        <div className={styles.detailGrid}>
          <ContextRow label={t('fieldId')}>{record.id}</ContextRow>
          <ContextRow label={t('fieldTime')}>
            {formatTimestamp(record.created_at, locale)}
          </ContextRow>
          <ContextRow label={t('fieldEnvironment')}>
            {record.environment}
          </ContextRow>
          <ContextRow label={t('fieldLayer')}>{record.application}</ContextRow>
          <ContextRow label={t('fieldChainId')}>
            {record.event_log_chain_id}
          </ContextRow>
          <ContextRow label={t('fieldClientUrl')}>
            {record.client_url}
          </ContextRow>
          <span className={styles.detailLabel}>{t('fieldUser')}</span>
          {record.user_id ? (
            <Link
              className={styles.userLink}
              href={adminUserHref({
                search: record.user_id,
                userId: record.user_id,
              })}>
              {t('showUser')}
            </Link>
          ) : (
            <p className={styles.detailValue}>{t('userMissing')}</p>
          )}
        </div>
      </section>

      <JsonBlock
        title={t('sectionPayload')}
        raw={record.payload}
        copyLabel={t('copyBlock')}
        emptyLabel={t('payloadEmpty')}
        onCopy={text => void copy(text)}
      />
      <JsonBlock
        title={t('sectionMetadata')}
        raw={record.user_metadata}
        copyLabel={t('copyBlock')}
        emptyLabel={t('noMetadata')}
        onCopy={text => void copy(text)}
      />

      <section>
        <h3 className={styles.sectionTitle}>{t('sectionGroup')}</h3>
        {group ? (
          <>
            <p className={styles.groupMeta}>
              <span>
                {t('columnOccurrences')}: {group.count.toLocaleString('pl-PL')}
              </span>
              <span>
                {t('firstSeenLabel')}{' '}
                {formatTimestamp(group.first_seen, locale)}
              </span>
              <span>
                {t('columnLastSeen')}:{' '}
                {formatTimestamp(group.last_seen, locale)}
              </span>
            </p>
            <LogIssueStatusEditorMolecule
              fingerprint={group.fingerprint}
              status={group.status}
              note={group.note}
              isPending={
                setStatus.isPending &&
                setStatus.variables?.fingerprint === group.fingerprint
              }
              onSetStatus={input => setStatus.mutate(input)}
            />
            <p className={styles.sectionTitle}>{t('recentLabel')}</p>
            <ul className={styles.occurrenceList}>
              {details.data.recent.map(item => (
                <OccurrenceButton
                  key={item.id}
                  record={item}
                  label={t('openLogAria')}
                  onOpen={onOpenLog}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.muted}>{t('groupMissing')}</p>
        )}
      </section>

      <section>
        <h3 className={styles.sectionTitle}>{t('sectionChain')}</h3>
        {details.data.chain.length === 0 ? (
          <p className={styles.muted}>{t('chainEmpty')}</p>
        ) : (
          <ul className={styles.occurrenceList}>
            {details.data.chain.map(item => (
              <OccurrenceButton
                key={item.id}
                record={item}
                label={t('openLogAria')}
                onOpen={onOpenLog}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
