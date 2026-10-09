// UI/features/salon-staff/SalonStaffPage.sections.organism.tsx
// Presentational sections of the salon team page (no data fetching):
//  - SalonStaffHero: AppHero with ONE line of live numbers
//  - SalonStaffPlanNote: at-limit / near-limit note with the plans link
//  - SalonStaffEmpty: locked notice (plan without staff accounts) or empty team
//  - SalonStaffListSkeleton: the loader, in the geometry of the real cards

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  LockKeyIcon,
  UserCircleIcon,
  UserPlusIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import styles from './SalonStaffPage.module.css';

/* ============================================================
 * SalonStaffHero
 * ============================================================ */

export interface SalonStaffSeats {
  used: number;
  max: number;
  isUnlimited: boolean;
  /** Invitations not accepted yet (they hold a seat already). */
  pending: number;
}

export interface SalonStaffHeroProps {
  heroTitle: string;
  /** Live numbers. null = plan without staff accounts or a failed load: the
   *  hero renders the title alone. */
  seats: SalonStaffSeats | null;
  /** The numbers are on their way: the line keeps its place with a skeleton,
   *  so the page does not jump when the roster arrives. */
  isSeatsLoading: boolean;
}

export function SalonStaffHeroOrganism({
  heroTitle,
  seats,
  isSeatsLoading,
}: SalonStaffHeroProps) {
  const t = useTranslations('salon.staff');
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

  // DECISION (nie usuwaj tego komentarza) — owner walk-through S126: the seat
  // usage was stated three times (this line, a „Limit planu” tile with a bar
  // and a „2 / 9” list header) next to tiles for „Aktywne” and „Zaproszone”.
  // It is stated ONCE, here; the only number the tiles added, the invitations
  // still waiting, is the second part of the same line. Do not bring the stat
  // strip back. No eyebrow and no marketing subtitle either (S25/D): the app
  // bar already carries „Zespół salonu”.
  const meta = seats ? (
    // ONE element, not two AppHero members: members are joined by the middle
    // dot the primitive draws between them, which the owner banned (S126
    // addendum). The two facts are one sentence with a comma; each fact is an
    // unbreakable piece, so a narrow screen moves the second one down whole.
    <div className={styles.heroMeta}>
      <span className={styles.heroFact}>
        {seats.isUnlimited
          ? t.rich('heroMetaUnlimited', { used: seats.used, strong })
          : t.rich('heroMetaSeats', {
              used: seats.used,
              max: seats.max,
              strong,
            })}
        {seats.pending > 0 && ','}
      </span>
      {seats.pending > 0 && (
        <>
          {' '}
          <span className={styles.heroFact}>
            {t('heroMetaPending', { count: seats.pending })}
          </span>
        </>
      )}
    </div>
  ) : isSeatsLoading ? (
    <span aria-hidden='true'>
      <SkeletonAtom variant='text' width={128} height={16} />
    </span>
  ) : null;

  return <AppHeroOrganism title={heroTitle} meta={meta} />;
}

/* ============================================================
 * SalonStaffPlanNote — the plan's seat limit, said in a sentence
 * ============================================================ */

export interface SalonStaffPlanNoteProps {
  /** At the limit the plans link IS the screen's main action (inviting is not
   *  possible), so it is the filled one; near the limit it is a quiet link. */
  isAtLimit: boolean;
  remainingSlots: number;
}

export function SalonStaffPlanNoteOrganism({
  isAtLimit,
  remainingSlots,
}: SalonStaffPlanNoteProps) {
  const t = useTranslations('salon.staff');

  return (
    <div className={styles.planNote}>
      <p className={styles.planNoteText}>
        {isAtLimit
          ? t('planNudgeAtLimit')
          : t('planNudgeNearLimit', { remaining: remainingSlots })}
      </p>
      <LinkButtonAtom
        href={ROUTES_FRONT.USER_ACCOUNT_PAY}
        variant={isAtLimit ? 'primary' : 'outlined'}
        size='md'
        direction='forward'
        className={styles.pageAction}>
        {t('planUpgradeCta')}
      </LinkButtonAtom>
    </div>
  );
}

/* ============================================================
 * SalonStaffEmpty — locked notice (FREE/PRO) OR empty team (Studio, nobody yet)
 * ============================================================ */

export interface SalonStaffEmptyProps {
  variant: 'locked' | 'empty';
  onCtaClick: () => void;
}

export function SalonStaffEmptyOrganism({
  variant,
  onCtaClick,
}: SalonStaffEmptyProps) {
  const t = useTranslations('salon.staff');

  const isLocked = variant === 'locked';
  const title = isLocked ? t('lockedTitle') : t('emptyTitle');
  const body = isLocked ? t('lockedBody') : t('emptyBody');
  const ctaLabel = isLocked ? t('planUpgradeCta') : t('emptyCta');

  return (
    <EmptyStateAtom
      size='page'
      className={styles.empty}
      icon={
        isLocked ? (
          <LockKeyIcon size={40} weight='regular' />
        ) : (
          <UserCircleIcon size={48} weight='duotone' />
        )
      }
      animate='float'
      title={title}
      titleAs='h2'
      description={body}
      action={
        <ButtonAtom
          variant='primary'
          size='md'
          icon={
            isLocked ? (
              <LockKeyIcon size={16} weight='bold' />
            ) : (
              <UserPlusIcon size={16} weight='bold' />
            )
          }
          onClick={onCtaClick}>
          {ctaLabel}
        </ButtonAtom>
      }
    />
  );
}

/* ============================================================
 * SalonStaffListSkeleton — same box as a real card, same grid
 * ============================================================ */

export function SalonStaffListSkeletonOrganism({
  withAction,
}: {
  /** The plan can invite: reserve the invite button above the list too. */
  withAction: boolean;
}) {
  return (
    <div className={styles.skeleton} aria-busy='true'>
      {withAction && (
        <SkeletonAtom
          variant='rect'
          className={`${styles.pageAction} ${styles.skeletonAction}`}
        />
      )}
      <div className={styles.staffGrid}>
        {[0, 1, 2].map(i => (
          <div key={i} className={styles.staffCard}>
            <div className={styles.cardRow}>
              <SkeletonAtom variant='circle' width={40} height={40} />
              <div className={styles.cardIdentity}>
                <SkeletonAtom variant='text' width='55%' height={18} />
                <SkeletonAtom variant='text' width='75%' height={14} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
