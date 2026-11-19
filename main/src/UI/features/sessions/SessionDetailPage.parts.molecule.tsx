// UI/features/sessions/SessionDetailPage.parts.molecule.tsx
// Small blocks of the stylist's session detail:
//   - SessionDetailSkeleton  (loading state with the final boxes)
//   - ClientCreditCard       (who sent the session, her card, the conversation)
//   - FirstSessionTip        (one-time explanation, dismissible)
// The note blocks live in `./SessionDetailPage.blocks.molecule.tsx`.

import { ChatCircleIcon } from '@phosphor-icons/react';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
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
 * CLIENT CREDIT — the sender, and the two ways from the session to her.
 *
 * DECISION: the sender is a group of rows (the product's one tappable row): her row opens her card,
 * the row under it the conversation. Before, the sender was a static box whose only control was an
 * icon-only refresh button; two clean-context readers could not tell what it did ("refresh, history
 * or renew the session") and neither found a way to answer the client's note. The refresh button is
 * gone: the query refetches when the screen regains focus, and the one state that waits for the
 * client (no photos yet) has its own labelled button. Without a live connection (she disconnected
 * since) there is nowhere to lead, so the sender is plain text in a box.
 * ============================================================ */

export function ClientCreditCardMolecule({
  clientName,
  cardHref,
  messageHref,
  t,
}: {
  clientName: string;
  /** Both set only while the stylist and the client are connected. */
  cardHref?: string | undefined;
  messageHref?: string | undefined;
  t: TSessions;
}) {
  if (cardHref === undefined || messageHref === undefined) {
    return (
      <section className={styles.creditCard} data-app-section='plain'>
        <AvatarAtom src={undefined} name={clientName} size='md' />
        <div className={styles.creditMain}>
          <span className={styles.creditLabel}>{t('inboxFromLabel')}</span>
          <span className={styles.creditName}>{clientName}</span>
        </div>
      </section>
    );
  }
  return (
    <NavRowListMolecule label={t('inboxFromLabel')}>
      <NavRowMolecule
        href={cardHref}
        leading={<AvatarAtom name={clientName} size='md' decorative />}
        label={clientName}
        description={t('inboxClientCard')}
        trailing='disc'
      />
      <NavRowMolecule
        href={messageHref}
        leading={
          <span className={styles.messageIconSlot}>
            <ChatCircleIcon size={20} />
          </span>
        }
        label={t('inboxMessageClient')}
        trailing='disc'
      />
    </NavRowListMolecule>
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
    <section className={styles.tip} data-app-section='plain'>
      <h2 className={styles.blockLabel} data-app-section-title=''>
        {t('firstSessionTitle')}
      </h2>
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
