// UI/features/shared/SharedPage.parts.organism.tsx
// Blocks of the stylist's session list: the session row (one look for open
// and finished sessions), the open-sessions section, the empty state and the
// loading skeleton. The archive lives in ./SharedPage.archive.organism.tsx.

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ImagesSquareIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { isTerminalSession } from '@kernel/domain/session-container/session-container.types';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import {
  NavRowListMolecule,
  NavRowListSkeletonMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import {
  formatArchiveDate,
  formatExpiryStatus,
  getDisplayName,
  isExpiringSoon,
  type TShared,
} from './shared.helpers';
import { SessionRowMolecule } from './sessions/SessionRow.molecule';
import styles from './SharedPage.module.css';

/* ─────────────────────────────────────────────
   Session row — the whole row is the link to the session
   ───────────────────────────────────────────── */

interface SessionStatus {
  label: string;
  color: string;
  pulse: boolean;
  /** The date that belongs to the status: time left for an open session, the
   *  day a finished one ended. */
  when: string | null;
  /** Less than a day left: the date line is set in full ink. */
  urgent: boolean;
  /** The time is what an open session has left: it joins the pill. */
  continues?: boolean;
}

function resolveSessionStatus(
  session: SessionContainerDTO,
  locale: string,
  t: TShared
): SessionStatus {
  if (isTerminalSession(session.lifecycleState)) {
    const date = formatArchiveDate(session, locale);
    return {
      label:
        session.lifecycleState === SessionContainerLifecycleStateValue.CLOSED
          ? t('statusClosed')
          : t('statusExpired'),
      color: 'var(--color-text-secondary)',
      pulse: false,
      when: date.length > 0 ? date : null,
      urgent: false,
    };
  }
  if (session.expiresAt === null) {
    return {
      label: t('draft'),
      color: 'var(--color-accent-fg)',
      pulse: false,
      when: null,
      urgent: false,
    };
  }
  return {
    label: t('statusActive'),
    color: 'var(--color-success)',
    pulse: true,
    when: formatExpiryStatus(session.expiresAt, t),
    urgent: isExpiringSoon(session.expiresAt),
    // Time still left: it reads as one phrase with the status, inside the
    // pill („Aktywna jeszcze 6 dni”). A passed date is a separate word.
    continues: new Date(session.expiresAt).getTime() > Date.now(),
  };
}

/* DECISION (nie usuwaj tego komentarza):
 * The row is SessionRowMolecule (features/shared/sessions), the SAME molecule
 * the client's list renders (features/sessions/ClientSessionsPage), built on
 * NavRowMolecule (owner vote `s126-wiersze`, 2026-10-09: one tappable row in
 * the product). Until then each role drew its own 116px card with its own
 * CSS. The stylist's row leads with the client's avatar, because her list is
 * a list of people; that is the only difference between the roles. Open and
 * finished sessions share the row; state is carried by the pill alone. The
 * status RULES stay per role (this resolver reads `expiresAt` and the
 * stylist's copy; the client's side maps all six lifecycle states). */
export function SharedSessionRowOrganism({
  session,
  locale,
}: {
  session: SessionContainerDTO;
  locale: string;
}) {
  const t = useTranslations('pages.shared');
  const displayName = getDisplayName(session, t('clientFallback'));
  const status = resolveSessionStatus(session, locale, t);

  return (
    <SessionRowMolecule
      href={buildRoute(ROUTES_FRONT.SESSION_DETAIL, {
        sessionId: session.id,
      })}
      avatarName={displayName}
      label={displayName}
      photoCountLabel={t('photoCount', { count: session.photoCount })}
      status={status}
      when={status.when}
      urgent={status.urgent}
      whenContinuesStatus={status.continues === true}
    />
  );
}

/* ─────────────────────────────────────────────
   Open sessions
   ───────────────────────────────────────────── */

export function SharedActiveSectionOrganism({
  sessions,
}: {
  sessions: SessionContainerDTO[];
}) {
  const t = useTranslations('pages.shared');
  const locale = useRouter().locale ?? 'pl-PL';
  return (
    <section className={styles.section}>
      {/* No count here: the hero already says how many are open. */}
      <h2 className={styles.sectionTitle}>{t('activeSectionTitleNew')}</h2>
      <NavRowListMolecule ariaLabel={t('activeSectionTitleNew')}>
        {sessions.map(session => (
          <SharedSessionRowOrganism
            key={session.id}
            session={session}
            locale={locale}
          />
        ))}
      </NavRowListMolecule>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Empty state — what a session is, the one action, one more thing to do
   ───────────────────────────────────────────── */

/* DECISION (nie usuwaj tego komentarza):
 * A session comes FROM a client, so the action that leads to the first one is
 * connecting with her: that is the one filled button. It used to be the first
 * of two numbered „next step” cards under a box with no action; repeating it
 * as a row under its own button would state one thing twice, so the list
 * below holds only the other step (the gallery).
 * `size='page'` when the whole view is empty; `'panel'` when finished sessions
 * still stand next to it. */
export function SharedEmptyStateOrganism({ size }: { size: 'page' | 'panel' }) {
  const t = useTranslations('pages.shared');
  const lang = useCurrentLang();

  return (
    <div className={styles.section}>
      <EmptyStateAtom
        size={size}
        icon={
          <PaperPlaneTiltIcon
            size={size === 'page' ? 44 : 28}
            weight='duotone'
          />
        }
        title={t('emptyTitleNew')}
        titleAs='h2'
        description={t('emptyDescNew')}
        lang={lang}
        action={
          <LinkButtonAtom
            href={ROUTES_FRONT.PAIRING}
            variant='primary'
            size='lg'
            direction='forward'>
            {t('emptyAction')}
          </LinkButtonAtom>
        }
      />
      <NavRowListMolecule ariaLabel={t('emptyMoreAriaLabel')}>
        <NavRowMolecule
          href={ROUTES_FRONT.GALLERY_UPLOAD_ASSET}
          icon={<ImagesSquareIcon />}
          label={t('galleryRowLabel')}
          description={t('galleryRowDesc')}
          trailing='disc'
        />
      </NavRowListMolecule>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Skeleton — a section title and three rows with the final box
   ───────────────────────────────────────────── */

export function SharedListSkeletonOrganism() {
  return (
    <div className={styles.section}>
      <SkeletonAtom variant='text' width={160} height={24} />
      <NavRowListSkeletonMolecule leading lines={3} />
    </div>
  );
}
