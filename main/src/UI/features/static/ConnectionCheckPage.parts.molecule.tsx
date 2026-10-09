// UI/features/static/ConnectionCheckPage.parts.molecule.tsx
// Prezentacyjne części strony diagnostycznej — wydzielone z composition
// (max-lines 300, S76): wiersz checka + ikony/kolejność + agregacja statusu.

import type { useTranslations } from 'next-intl';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import styles from './ConnectionCheckPage.module.css';

/* ─── Types ─── */

export type CheckStatus = 'checking' | 'ok' | 'warn' | 'fail';

export type CheckKey = 'frontend' | 'backend' | 'session' | 'runtime';

export interface CheckState {
  status: CheckStatus;
  detail?: string;
}

export type ChecksRecord = Record<CheckKey, CheckState>;

interface CheckRowProps {
  checkKey: CheckKey;
  state: CheckState;
  t: ReturnType<typeof useTranslations<'pages.connectionCheck'>>;
}

/* ─── Helpers ─── */

export function overallStatus(checks: ChecksRecord): CheckStatus {
  const values = Object.values(checks);
  if (values.some(c => c.status === 'fail')) {
    return 'fail';
  }
  if (values.some(c => c.status === 'warn')) {
    return 'warn';
  }
  if (values.some(c => c.status === 'checking')) {
    return 'checking';
  }
  return 'ok';
}

/* Status colour of the pill (StatusPillAtom owns the tint recipe). */
const STATUS_COLOR: Record<CheckStatus, string> = {
  checking: 'var(--color-text-secondary)',
  ok: 'var(--color-success)',
  warn: 'var(--color-warning)',
  fail: 'var(--color-error)',
};

export const CHECK_ORDER: CheckKey[] = [
  'frontend',
  'backend',
  'session',
  'runtime',
];

/* ─── Sub-components ─── */

export function CheckRowMolecule({ checkKey, state, t }: CheckRowProps) {
  const description = state.detail ?? t(`checks.${checkKey}.description`);

  return (
    <li className={styles.checkRow}>
      <div className={styles.checkBody}>
        <span className={styles.checkLabel}>
          {t(`checks.${checkKey}.label`)}
        </span>
        <span className={styles.checkDescription}>{description}</span>
      </div>
      <StatusPillAtom
        color={STATUS_COLOR[state.status]}
        label={t(`statusLabels.${state.status}`)}
        pulse={state.status === 'checking'}
        className={styles.checkPill}
      />
    </li>
  );
}
