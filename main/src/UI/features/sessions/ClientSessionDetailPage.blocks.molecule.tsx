// UI/features/sessions/ClientSessionDetailPage.blocks.molecule.tsx
// Read-only blocks of the client's session detail:
//   - DetailStylistCredit  (who the session is for)
//   - DetailNoteCallout    (her note, read-only, on a finished session)
//   - DetailSkeleton       (loading state with the final boxes)
//
// The photos live in ./SessionPhotos.organism.tsx (shared with the stylist's
// view); blocks with actions (share box, close) in `.actions.molecule.tsx`.

import { UserCircleDashedIcon } from '@phosphor-icons/react';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { isActiveSession } from '@kernel/domain/session-container/session-container.types';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './ClientSessionDetailPage.module.css';
import type { TSessions } from './sessionTime.formatters';

/* ============================================================
 * STYLIST CREDIT — who receives the session.
 * ============================================================ */

export function DetailStylistCreditMolecule({
  hasStylist,
  stylistDisplayName,
  stylistAvatarUrl,
  fallbackName,
  lifecycleState,
  stylistMessagePairId,
  t,
}: {
  /** Session has a stylist (stylistAccountId set) — even when the name could
   *  not be resolved (pair gone / pairs query failed). */
  hasStylist: boolean;
  stylistDisplayName: string | null;
  stylistAvatarUrl: string | null;
  fallbackName: string;
  lifecycleState: SessionContainerDetailDTO['lifecycleState'];
  stylistMessagePairId: string | undefined;
  t: TSessions;
}) {
  return (
    <section className={styles.creditCard} data-app-section='plain'>
      {/* Without a stylist there is no person to sign: initials from the label
          („Klientka" → „KL") posed as someone's avatar. */}
      {hasStylist ? (
        <AvatarAtom
          src={stylistAvatarUrl ?? undefined}
          name={stylistDisplayName ?? fallbackName}
          size='md'
        />
      ) : (
        <UserCircleDashedIcon
          size={40}
          weight='light'
          aria-hidden='true'
          className={styles.creditEmptyIcon}
        />
      )}
      <div className={styles.creditMain}>
        <span className={styles.creditLabel}>
          {hasStylist
            ? t('detailCreditLabel')
            : t('detailCreditLabelNoStylist')}
        </span>
        {hasStylist && (
          <span className={styles.creditName}>
            {stylistDisplayName ?? fallbackName}
          </span>
        )}
        {hasStylist &&
          isActiveSession(lifecycleState) &&
          stylistMessagePairId && (
            <LinkButtonAtom
              href={`${buildRoute(ROUTES_FRONT.MESSAGES_THREAD, {
                pairId: stylistMessagePairId,
              })}?fromSession=1`}
              variant='outlined'
              size='md'>
              {t('detailMessageStylist')}
            </LinkButtonAtom>
          )}
      </div>
    </section>
  );
}

/* ============================================================
 * CLIENT NOTE, READ-ONLY — a finished session keeps what she wrote.
 * ============================================================ */

export function DetailNoteCalloutMolecule({
  clientNote,
  t,
}: {
  clientNote: string;
  t: TSessions;
}) {
  const lang = useCurrentLang();
  return (
    <section className={styles.readNote} data-app-section='plain'>
      <h2 className={styles.blockLabel} data-app-section-title=''>
        {t('detailNoteCalloutTitle')}
      </h2>
      <p className={styles.readNoteBody} lang={lang}>
        {clientNote}
      </p>
    </section>
  );
}

/* ============================================================
 * SKELETON — title, action box, credit row and the square photo.
 * ============================================================ */

export function DetailSkeletonMolecule() {
  return (
    <div className={styles.page} aria-busy='true'>
      <SkeletonAtom variant='text' width='60%' height={32} />
      <SkeletonAtom variant='rect' width='100%' height={132} />
      <SkeletonAtom variant='rect' width='100%' height={64} />
      <div className={styles.photoSkeleton}>
        <SkeletonAtom variant='rect' width='100%' height='100%' />
      </div>
    </div>
  );
}
