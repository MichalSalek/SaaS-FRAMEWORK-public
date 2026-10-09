// UI/features/support/SupportThreadsPage.parts.organism.tsx
// Parts of the „Twoje zgłoszenia” screen: the thread row, the list skeleton
// and the empty state.

import { type CSSProperties } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { SupportThreadListItem } from '@kernel/models/support/support.dto';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { AffordanceDiscAtom } from '../../components/AffordanceDisc/AffordanceDisc.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { IllustrationAtom } from '../../components/Illustration/Illustration.atom';
import { LP_ASSETS } from '../../assets/lpAssets';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import {
  type TSupport,
  getSupportStatusColor,
  getStatusLabel,
} from './supportStatus.helpers';
import { formatRelativeDate } from './supportDate.helpers';
import styles from './SupportThreadsPage.module.css';

/* ============================================================
 *  Thread row
 * ============================================================ */

interface ThreadRowProps {
  thread: SupportThreadListItem;
  staggerIndex: number;
  t: TSupport;
}

export function ThreadRowOrganism({ thread, staggerIndex, t }: ThreadRowProps) {
  const lang = useCurrentLang();

  return (
    <li
      className={styles.staggerIn}
      style={{ '--stagger-index': staggerIndex } as CSSProperties}>
      <Link
        href={buildRoute(ROUTES_FRONT.SUPPORT_THREAD, { threadId: thread.id })}
        className={`${styles.threadRow} haptic-press`}>
        <span className={styles.threadBody}>
          <span className={styles.threadTitle} data-truncate='content'>
            {/* The dot encodes state (a reply she has not opened), read out
                through the hidden text; the server owns the rule
                (`has_unread_reply`, same as the unread count). */}
            {thread.has_unread_reply && (
              <>
                <span className={styles.threadUnreadDot} aria-hidden='true' />
                <span className='sr-only'>{t('unreadMarker')}. </span>
              </>
            )}
            {thread.subject}
          </span>
          <span className={styles.threadMetaLine}>
            {/* A thread from before categories existed has none. */}
            {thread.category !== null && (
              <span className={styles.threadCategory}>
                {t(`categories.${thread.category}`)}
              </span>
            )}
            <span>{formatRelativeDate(thread.updated_at, t, lang)}</span>
          </span>
        </span>
        <StatusPillAtom
          className={styles.threadStatus}
          color={getSupportStatusColor(thread.status)}
          label={getStatusLabel(t, thread.status)}
          showDot={false}
        />
        {/* A tappable row carries the affordance mark (DESIGN.md item 14). */}
        <AffordanceDiscAtom className={styles.threadArrow} />
      </Link>
    </li>
  );
}

/* ============================================================
 *  Skeleton: the geometry of three rows
 * ============================================================ */

export function ThreadListSkeletonMolecule() {
  return (
    <div className={styles.skeletonList}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonRowBody}>
            <SkeletonAtom variant='text' width='70%' height={18} />
            <SkeletonAtom variant='text' width='45%' height={14} />
          </div>
          <SkeletonAtom variant='rect' width={72} height={24} />
        </div>
      ))}
    </div>
  );
}

/* ============================================================
 *  Empty state: illustration + the way to the new-request screen
 * ============================================================ */

interface EmptyStateProps {
  title: string;
  body: string;
  ctaLabel: string;
}

export function ThreadsEmptyStateOrganism({
  title,
  body,
  ctaLabel,
}: EmptyStateProps) {
  const lang = useCurrentLang();
  return (
    <EmptyStateAtom
      className={`${styles.emptyState} ${styles.staggerIn}`}
      style={{ '--stagger-index': 1 } as CSSProperties}
      illustration={
        <IllustrationAtom src={LP_ASSETS.decor.staticHelpThread} size='lg' />
      }
      title={title}
      titleAs='h2'
      description={body}
      lang={lang}
      action={
        <LinkButtonAtom
          href={ROUTES_FRONT.SUPPORT_NEW}
          variant='primary'
          size='lg'
          icon={<PlusIcon size={18} weight='bold' />}
          className='haptic-press'>
          {ctaLabel}
        </LinkButtonAtom>
      }
    />
  );
}
