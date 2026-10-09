// UI/features/sessions/ClientSessionDetailPage.blocks.molecule.tsx
// Read-only blocks of the client's session detail:
//   - DetailStylistCredit  (who the session is for)
//   - DetailNoteCallout    (her note, read-only, on a finished session)
//   - DetailSkeleton       (loading state with the final boxes)
//
// The photos live in ./SessionPhotos.organism.tsx (shared with the stylist's
// view); blocks with actions (share box, close) in `.actions.molecule.tsx`.

import { UserCircleDashedIcon } from '@phosphor-icons/react';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
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
  fallbackName,
  t,
}: {
  /** Session has a stylist (stylistAccountId set) — even when the name could
   *  not be resolved (pair gone / pairs query failed). */
  hasStylist: boolean;
  stylistDisplayName: string | null;
  fallbackName: string;
  t: TSessions;
}) {
  return (
    <section className={styles.creditCard}>
      {/* Bez stylistki nie ma osoby do podpisania: inicjały z etykiety
          („Klientka" → „KL") udawały czyjś awatar. */}
      {hasStylist ? (
        <AvatarAtom
          src={undefined}
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
    <section className={styles.readNote}>
      <h2 className={styles.blockLabel}>{t('detailNoteCalloutTitle')}</h2>
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
