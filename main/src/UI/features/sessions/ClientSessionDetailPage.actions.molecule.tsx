// UI/features/sessions/ClientSessionDetailPage.actions.molecule.tsx
// Blocks with actions of the client's session detail:
//   - DetailShareSection  (the main action of the screen, by session state)
//   - DetailNoPhotos      (empty state of a session without photos)
//   - DetailCloseAction   (ending the session, at the bottom)
//   - DetailCloseDialog   (its confirmation)

import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  ImagesIcon,
  PaperPlaneTiltIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { PushSoftAskOrganism } from '../shared/push/PushSoftAsk.organism';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { tFormatTimeSinceShared } from './ClientSessionDetailPage.formatters';
import styles from './ClientSessionDetailPage.module.css';
import type { TSessions } from './sessionTime.formatters';
import { SessionNextStepsMolecule } from './components/SessionNextSteps.molecule';

type TShare = ReturnType<typeof useTranslations<'pages.sessionShare'>>;

/* ============================================================
 * SHARE SECTION — the one filled action, right under the title.
 *
 * DECISION: the filled button follows the state of a session that HAS photos: DRAFT / READY ->
 * "Udostępnij stylistce" filled, adding more is outlined; SHARED / ACTIVE -> she already has them,
 * adding more is the filled action. A session without photos has no share box at all
 * (DetailNoPhotos carries the single action there), so the screen never shows two filled buttons.
 * The box sits ABOVE the photos: at the bottom of the page the main action was 1300px down, under
 * three photos, a note and a status card.
 * ============================================================ */

export function DetailShareSectionMolecule({
  isShared,
  session,
  stylistPairId,
  stylistPhone,
  shareIsPending,
  onShare,
  onAddFromGallery,
  t,
  tShare,
}: {
  isShared: boolean;
  session: SessionContainerDetailDTO;
  /** Live conversation with the stylist; undefined when there is no pair. */
  stylistPairId: string | undefined;
  /** Public phone; null when the stylist did not publish one. */
  stylistPhone: string | null;
  shareIsPending: boolean;
  onShare: () => void;
  onAddFromGallery: () => void;
  t: TSessions;
  tShare: TShare;
}) {
  const lang = useCurrentLang();
  const hasStylist = session.stylistAccountId !== null;
  const sharedSince = tFormatTimeSinceShared(session.sharedAt, t);

  return (
    <section className={styles.actionBox}>
      <div className={styles.actionText}>
        {isShared ? (
          <>
            <div className={styles.sharedSuccess}>
              <CheckCircleIcon
                size={44}
                weight='fill'
                className={styles.sharedSuccessIcon}
                aria-hidden='true'
              />
              <h2 className={styles.sharedSuccessTitle}>
                {t('detailSharedConfirmTitle')}
              </h2>
              {sharedSince.length > 0 && (
                <p className={styles.sharedSuccessBody}>{sharedSince}</p>
              )}
              {/* Readers could not tell whether a photo added now is sent. */}
              <p className={styles.sharedSuccessBody} lang={lang}>
                {t('detailSharedLiveHint')}
              </p>
            </div>
            <SessionNextStepsMolecule
              pairId={stylistPairId}
              phone={stylistPhone}
            />
            {/* The session now waits for the stylist's
                answer, a moment a push obviously helps (soft ask). */}
            <PushSoftAskOrganism moment='sessionShared' />
          </>
        ) : null}
      </div>
      <div className={styles.actionButtons}>
        {!isShared && (
          <ButtonAtom
            variant='primary'
            size='lg'
            icon={<PaperPlaneTiltIcon />}
            onClick={onShare}
            loading={shareIsPending}
            className='press-feedback'>
            {tShare('shareToStylist')}
          </ButtonAtom>
        )}
        {hasStylist && (
          <ButtonAtom
            variant='outlined'
            size='lg'
            icon={<ImagesIcon weight='fill' />}
            className='press-feedback'
            onClick={onAddFromGallery}>
            {t('addFromGallery')}
          </ButtonAtom>
        )}
      </div>
    </section>
  );
}

/* ============================================================
 * NO PHOTOS — says what is missing and offers the one way forward.
 * The old screen had two buttons here („Przeglądaj galerię stylistki” and
 * „Dodaj inspiracje z galerii”) that opened the same gallery.
 * ============================================================ */

export function DetailNoPhotosMolecule({
  canAdd,
  isShared = false,
  onAddFromGallery,
  t,
}: {
  /** The session has a stylist whose gallery can be opened. */
  canAdd: boolean;
  /** Already shared and emptied since (photos can be taken out): „add one to
   *  share it” would be false, the stylist has the session. */
  isShared?: boolean;
  onAddFromGallery: () => void;
  t: TSessions;
}) {
  return (
    <EmptyStateAtom
      size='panel'
      icon={<ImagesIcon size={32} weight='duotone' />}
      title={t(isShared ? 'detailNoPhotosShared' : 'addPhotoToShare')}
      titleAs='h2'
      {...(canAdd
        ? {
            action: (
              <ButtonAtom
                variant='primary'
                size='lg'
                icon={<ImagesIcon weight='fill' />}
                className='press-feedback'
                onClick={onAddFromGallery}>
                {t('addFromGallery')}
              </ButtonAtom>
            ),
          }
        : {})}
    />
  );
}

/* ============================================================
 * CLOSE — the irreversible action, last on the page, never filled.
 * ============================================================ */

export function DetailCloseActionMolecule({
  onCloseSession,
  closeIsPending,
  t,
}: {
  onCloseSession: () => void;
  closeIsPending: boolean;
  t: TSessions;
}) {
  return (
    <div className={styles.closeRow}>
      <ButtonAtom
        variant='text'
        size='md'
        icon={<XCircleIcon />}
        className={`${styles.closeAction} press-feedback`}
        onClick={onCloseSession}
        disabled={closeIsPending}>
        {t('closeSession')}
      </ButtonAtom>
    </div>
  );
}

/* DECISION: the body says what closing DOES, by what the backend does. A shared session that is
   closed stays readable for the stylist and becomes a visit in her history of this client
   (`visit-session-archive.operations`). A session that was never shared stays invisible to the
   stylist. The dialog stays open while the close is in flight (the spinner in the button is then
   actually seen); success navigates to the list (hook), a failure (toasted by the interceptor)
   leaves it open for a retry. The label never changes, so the button keeps its width. */
export function DetailCloseDialogMolecule({
  open,
  isPending,
  onOpenChange,
  onConfirm,
  body,
  t,
}: {
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** What closing does for the person who closes (client: by whether the
   *  stylist has received the session; stylist: her own sentence). */
  body: string;
  t: TSessions;
}) {
  const tButtons = useTranslations('buttons');
  return (
    <AppDialogAtom
      open={open}
      onOpenChange={nextOpen => {
        if (nextOpen || !isPending) {
          onOpenChange(nextOpen);
        }
      }}
      disablePointerDismissal>
      <AppDialogAtom.Content
        title={t('closeConfirmTitle')}
        closeDisabled={isPending}>
        <AppDialogAtom.Body>
          <TypographyAtom variant='body2'>{body}</TypographyAtom>
        </AppDialogAtom.Body>
        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            {tButtons('cancel')}
          </ButtonAtom>
          <ButtonAtom
            variant='primary'
            size='md'
            icon={<XCircleIcon />}
            onClick={onConfirm}
            loading={isPending}>
            {t('closeSession')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
