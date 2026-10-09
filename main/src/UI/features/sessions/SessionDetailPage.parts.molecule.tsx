// UI/features/sessions/SessionDetailPage.parts.molecule.tsx
// Small blocks of the stylist's session detail:
//   - SessionDetailSkeleton  (loading state with the final boxes)
//   - ClientCreditCard       (who sent the session + refresh)
//   - FirstSessionTip        (one-time explanation, dismissible)
// The note blocks live in `./SessionDetailPage.blocks.molecule.tsx`.

import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './SessionDetailPage.module.css';
import type { TSessions } from './sessionTime.formatters';

/* ============================================================
 * SKELETON — title, sender row and the square photo.
 * ============================================================ */

export function SessionDetailSkeletonMolecule() {
  return (
    <div className={styles.page} aria-busy='true'>
      <SkeletonAtom variant='text' width='60%' height={32} />
      <SkeletonAtom variant='rect' width='100%' height={68} />
      <div className={styles.photoSkeleton}>
        <SkeletonAtom variant='rect' width='100%' height='100%' />
      </div>
    </div>
  );
}

/* ============================================================
 * CLIENT CREDIT CARD — the sender, with the row's one control.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Mirror of DetailStylistCredit from ClientSessionDetailPage with the roles
 * swapped — here the stylist is the recipient, the client is the sender.
 * Refresh is the ONE trailing control of this row, as an icon-only button.
 * History: a labelled „Odśwież” button in this row truncated the client name
 * („Weronika Ziel…”), so it was moved to a row of its own above the card,
 * where it took 60px of the fold for a rarely used action. The icon-only
 * button costs 44px and the name wraps instead of being cut, so both
 * problems are gone. Do not give it a visible label again.
 * ============================================================ */

export function ClientCreditCardMolecule({
  clientName,
  onRefresh,
  isRefreshing,
  t,
}: {
  clientName: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  t: TSessions;
}) {
  return (
    <section className={styles.creditCard}>
      <AvatarAtom src={undefined} name={clientName} size='md' />
      <div className={styles.creditMain}>
        <span className={styles.creditLabel}>{t('inboxFromLabel')}</span>
        <span className={styles.creditName}>{clientName}</span>
      </div>
      <ButtonAtom
        variant='outlined'
        size='md'
        ariaLabel={t('refreshBtn')}
        icon={<ArrowClockwiseIcon weight='bold' />}
        onClick={onRefresh}
        loading={isRefreshing}
      />
    </section>
  );
}

/* ============================================================
 * FIRST-SESSION TIP — shown until acknowledged, once per device.
 * It stands AFTER the photos: the inspirations are the content of the screen,
 * the explanation of what to do with them follows.
 * ============================================================ */

export function FirstSessionTipMolecule({
  onAcknowledge,
  t,
}: {
  onAcknowledge: () => void;
  t: TSessions;
}) {
  const lang = useCurrentLang();
  return (
    <section className={styles.tip}>
      <h2 className={styles.blockLabel}>{t('firstSessionTitle')}</h2>
      <p className={styles.tipBody} lang={lang}>
        {t('firstSessionHint')}
      </p>
      <div className={styles.tipAction}>
        <ButtonAtom variant='outlined' size='md' onClick={onAcknowledge}>
          {t('firstSessionAck')}
        </ButtonAtom>
      </div>
    </section>
  );
}
