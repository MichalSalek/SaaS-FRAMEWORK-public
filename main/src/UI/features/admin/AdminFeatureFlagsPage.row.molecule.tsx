// UI/features/admin/AdminFeatureFlagsPage.row.molecule.tsx
// One feature flag as a setting row: its name (bold, one piece), what it does
// (regular), its key, one line of state, and a switch with its state in a
// word. The row's skeleton has the same boxes.

import { useTranslations } from 'next-intl';
import { ClockIcon, WarningIcon } from '@phosphor-icons/react';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { ToggleAtom } from '../../components/Toggle/Toggle.atom';
import { formatDate } from '../../../application/date/date.utils';
import type { FeatureFlagItem } from './hooks/useAdminFeatureFlags';
import { getRetirementStatus } from './feature-flags.model';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminFeatureFlagsPage.module.css';

/* Flags the product knows by name. The name and the description are two
   strings: one bold sentence carrying both wrapped to three bold lines on a
   phone. */
const KNOWN_FLAGS = [
  'blog_enabled',
  'explore_enabled',
  'salon_staff_enabled',
  'stripe_embedded_checkout_enabled',
  'stripe_hosted_fallback_enabled',
] as const;

type KnownFlag = (typeof KNOWN_FLAGS)[number];

function knownFlag(key: string): KnownFlag | null {
  return KNOWN_FLAGS.find(known => known === key) ?? null;
}

export function FlagRowSkeletonMolecule() {
  return (
    <li className={styles.row} aria-hidden='true'>
      <div className={styles.text}>
        <SkeletonAtom variant='text' width='50%' height={20} />
        <SkeletonAtom variant='text' width='75%' height={16} />
        <SkeletonAtom variant='text' width='45%' height={16} />
        <SkeletonAtom variant='text' width='35%' height={16} />
      </div>
      <div className={styles.control}>
        <SkeletonAtom variant='rect' width={44} height={24} />
      </div>
    </li>
  );
}

interface FlagRowProps {
  flag: FeatureFlagItem;
  /** The toggle of THIS flag is on its way to the server. */
  isPending: boolean;
  /** The last toggle of this flag failed (it was rolled back). */
  hasFailed: boolean;
  onToggle: (key: string, nextEnabled: boolean) => void;
}

export function FlagRowMolecule({
  flag,
  isPending,
  hasFailed,
  onToggle,
}: FlagRowProps) {
  const t = useTranslations('admin.featureFlags');
  const known = knownFlag(flag.key);
  // An unknown flag (a DB row the copy does not know yet) is named by its key
  // and described by what the database says.
  const description =
    known !== null ? t(`flagDescriptions.${known}`) : flag.description;
  const retirement = getRetirementStatus(flag.expires_at ?? null);

  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <p className={styles.label}>
          {known !== null ? (
            t(`flagLabels.${known}`)
          ) : (
            <SoftBreakTextAtom>{flag.key}</SoftBreakTextAtom>
          )}
        </p>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
        {/* A named flag shows its key; an unknown one is already named by it. */}
        {known !== null && (
          <p className={styles.flagKey}>
            <SoftBreakTextAtom>{flag.key}</SoftBreakTextAtom>
          </p>
        )}
        {/* ONE line of state under the row: saving, a failed save, or the date
            of the last change. It is always there, so a toggle moves nothing,
            and a failure is said next to the switch that caused it. */}
        <p className={styles.state} role='status'>
          {isPending ? (
            t('rowSaving')
          ) : hasFailed ? (
            <span className={styles.stateError}>{t('rowSaveError')}</span>
          ) : (
            <span className={styles.nowrap}>
              {t('changedLabel', { date: formatDate(flag.updated_at) })}
            </span>
          )}
        </p>
        {/* DECISION (nie usuwaj tego komentarza):
            The admin UI READS expires_at (retirement pill) and has no control
            to SET it. Deliberate: expires_at is given at seed / migration; the
            sweep (feature-flag-expiry.interceptor) flips expired flags; a
            toggle-enable clears a stale expiry. A manual control is deferred
            (zero flags with expires_at in prod). Do NOT re-flag the missing
            set-control as a bug. */}
        {retirement.kind === 'overdue' && (
          <StatusPillAtom
            color='var(--color-error)'
            icon={<WarningIcon size={14} weight='fill' aria-hidden='true' />}
            label={t('retirementOverdue', { days: retirement.daysOverdue })}
          />
        )}
        {retirement.kind === 'expiring' && (
          <StatusPillAtom
            color='var(--color-warning)'
            icon={<ClockIcon size={14} weight='fill' aria-hidden='true' />}
            label={t('retirementExpiring', { days: retirement.daysLeft })}
          />
        )}
      </div>
      <div className={styles.control}>
        {/* The switch plus a word, like on the config page: colour alone must
            not carry the state. The word stands BEFORE the switch in a slot
            of fixed width, so „Wł.” / „Wył.” never moves the switch. */}
        <span className={styles.stateWord} aria-hidden='true'>
          {flag.is_enabled ? t('stateOn') : t('stateOff')}
        </span>
        <ToggleAtom
          checked={flag.is_enabled}
          disabled={isPending}
          aria-busy={isPending}
          onChange={() => onToggle(flag.key, !flag.is_enabled)}
          aria-label={t('toggleAriaLabel', { key: flag.key })}
        />
      </div>
    </li>
  );
}
