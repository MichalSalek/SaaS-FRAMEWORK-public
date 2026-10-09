// UI/features/admin/AdminLogsPage.parts.molecule.tsx
// Small parts of the logs page: level badge, message text, stats strip and
// the verbose switch.

import { useTranslations } from 'next-intl';
import { InfoIcon, WarningIcon, XCircleIcon } from '@phosphor-icons/react';
import type { SendLogType } from '@kernel/domain/admin/send-log.config';
import { formatDateShortPL } from '../../../application/date/date.utils';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../components/StatTile/StatTile.molecule';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminLogsPage.module.css';

/* ─── Helpers ─── */

// App Log Store records carry severity levels (SEND_LOG_TYPES kernel SSOT:
// 'info' | 'warn' | 'error'), NOT EventLogTypeValue domain categories — so the
// semantic palette belongs here: this badge answers "how bad is it".
const TYPE_COLOR_MAP: Record<SendLogType, string> = {
  info: 'var(--color-info)',
  warn: 'var(--color-warning)',
  error: 'var(--color-error)',
};

const isSendLogType = (type: string): type is SendLogType =>
  type in TYPE_COLOR_MAP;

function getTypeColor(type: string): string {
  return isSendLogType(type)
    ? TYPE_COLOR_MAP[type]
    : 'var(--color-text-disabled)';
}

function TypeIconAtom({ type }: { type: string }): React.ReactElement {
  const size = 11;
  if (type === 'warn') {
    return <WarningIcon size={size} weight='bold' />;
  }
  if (type === 'error') {
    return <XCircleIcon size={size} weight='bold' />;
  }
  return <InfoIcon size={size} weight='bold' />;
}

/* ─── TypeBadge ─── */

// DECISION (nie usuwaj tego komentarza) — S126: the pill shows the POLISH
// name of the level (informacja / ostrzeżenie / błąd), not the stored value in
// capitals. The raw value stays one hover away (`title`) and in the detail
// sheet, where it is what you paste into a query. A value outside today's list
// (historic row) is shown as stored instead of a missing-translation key.
export function TypeBadgeMolecule({ type }: { type: string }) {
  const t = useTranslations('admin.logs');
  return (
    <span title={t('rawValue', { value: type })}>
      <StatusPillAtom
        color={getTypeColor(type)}
        icon={<TypeIconAtom type={type} />}
        label={isSendLogType(type) ? t(`type_${type}`) : type}
      />
    </span>
  );
}

/* ─── LogNamespace ─── */

// An identifier wider than its column breaks AFTER an underscore
// („EMAIL_LIFECYCLE_” | „INTERCEPTOR”), never in the middle of a word.
export function LogNamespaceMolecule({ value }: { value: string }) {
  return <SoftBreakTextAtom>{value}</SoftBreakTextAtom>;
}

/* ─── LogMessage ─── */

// A short remark in parentheses („(code 500)”, „(retry 2 of 3)”) is one piece:
// it moves to the next line whole instead of breaking after its first word.
// Longer ones stay breakable, or they would not fit a 360px card.
const UNBREAKABLE_REMARK = /(\([^()\s][^()]{0,26}\))/;

export function LogMessageMolecule({ text }: { text: string }) {
  return (
    // Free text written by the system, not an interface label: the alignment
    // probe skips it (`data-truncate='content'`, scripts/qa-alignment-probe).
    <span data-truncate='content'>
      {text.split(UNBREAKABLE_REMARK).map((part, index) =>
        index % 2 === 1 ? (
          <span key={`${String(index)}-${part}`} className={styles.nowrap}>
            {part}
          </span>
        ) : (
          part
        )
      )}
    </span>
  );
}

/* ─── StatsStrip ─── */

export function LogsStatsStripMolecule({
  totalCount,
  totalLabel,
  pageCount,
  pageLabel,
  oldestRecordDate,
}: {
  totalCount: number | null;
  /** What the total counts: events in the stream, error classes in groups. */
  totalLabel: string;
  pageCount: number;
  pageLabel: string;
  oldestRecordDate: string | null;
}) {
  const t = useTranslations('admin.logs');

  // One colour for every value: the page count used to be drawn in the accent
  // with nothing to say by it (one colour axis, DESIGN.md Style Policy).
  return (
    <StatTileBandMolecule ariaLabel={t('statsAriaLabel')}>
      {totalCount !== null && (
        <StatTileMolecule
          label={totalLabel}
          value={totalCount.toLocaleString('pl-PL')}
        />
      )}
      <StatTileMolecule
        label={pageLabel}
        value={pageCount.toLocaleString('pl-PL')}
      />
      {oldestRecordDate && (
        <StatTileMolecule
          label={t('statOldestLabel')}
          value={
            <span className={styles.nowrap}>
              {formatDateShortPL(oldestRecordDate)}
            </span>
          }
        />
      )}
    </StatTileBandMolecule>
  );
}

/* ─── VerboseTogglePill ─── */

export function VerboseTogglePill({
  verboseOn,
  toggling,
  loading,
  unknown,
  onToggle,
}: {
  verboseOn: boolean;
  toggling: boolean;
  loading: boolean;
  /** Config read failed: the current state is not known, so no toggling. */
  unknown: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('admin.logs');

  const label = toggling
    ? t('verboseSwitching')
    : loading
      ? t('loading')
      : unknown
        ? t('verboseUnknown')
        : verboseOn
          ? t('verboseOn')
          : t('verboseOff');

  return (
    <button
      type='button'
      className={`${styles.verboseToggle} ${verboseOn ? styles.verboseToggleOn : styles.verboseToggleOff}`}
      disabled={toggling || loading || unknown}
      onClick={onToggle}
      aria-label={t('verboseToggleAriaLabel')}
      aria-pressed={unknown ? undefined : verboseOn}>
      <span className={styles.verboseToggleDot} aria-hidden='true' />
      {label}
    </button>
  );
}
