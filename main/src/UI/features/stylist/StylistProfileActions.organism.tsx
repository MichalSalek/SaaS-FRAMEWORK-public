import { useState, useEffect } from 'react';
import type { PairingAudience } from '../shared/pairing/pairingAudience';
import { CANCEL_REQUEST_HASH } from './_client-onboarding.helpers';
import { useTranslations } from 'next-intl';
import {
  BookmarkSimpleIcon,
  EyeIcon,
  HourglassIcon,
  UserCheckIcon,
  UserPlusIcon,
  WarningIcon,
  ChatsCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { StylistProfileShareMolecule } from './StylistProfileShare.molecule';
import { StylistProfileMessageActionMolecule } from './StylistProfileMessageAction.molecule';
import { StylistProfileRoleActionMolecule } from './StylistProfileRoleAction.molecule';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { StylistPhoneContactMolecule } from './StylistPhoneContact.molecule';
import { StylistPairingExplainerMolecule } from './StylistPairingExplainer.molecule';
import { useCancelPairRequest } from '../shared/pairing/hooks/usePairRequests';
import styles from './StylistProfilePage.module.css';

type AccountData =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE']['account'];

const UNPAIR_KEYWORD = 'ROZLACZ' as const;

interface StylistProfileActionsProps {
  account: AccountData;
  isPaired: boolean;
  /** Permanent QR code: a PENDING request waits for the stylist's acceptance. */
  isPendingRequest: boolean;
  audience: PairingAudience;
  /** The stylist's phone, PII-encoded (server-side): the CTA „Zadzwoń" in the
   *  cancel-request dialog. null when the stylist gave no number. */
  encodedPhone?: string | null | undefined;
  /** Id of the PENDING pair: the key into the messenger („Napisz do stylistki")
   *  from the cancel dialog. null when unknown. */
  pairId?: string | null | undefined;
  /** Clients can request; guests sign in first. Stylist-mode actions use the explicit audience. */
  canRequestPair: boolean;
  isRequestingPair: boolean;
  isBookmarked: boolean;
  /** An in-flight bookmark mutation: the button accepts no second click. */
  isBookmarkPending: boolean;
  /** Bookmarking a stylist is CLIENT-only (BOOKMARK_STYLIST); hide the CTA otherwise. */
  canBookmark: boolean;
  unpairDialogOpen: boolean;
  unpairConfirmText: string;
  onToggleBookmark: () => void;
  onRequestPair: () => void;
  onContact: () => void;
  contactPending: boolean;
  contactFailed?: boolean;
  onUnpairDialogOpenChange: (open: boolean) => void;
  onUnpairConfirmTextChange: (text: string) => void;
  onConfirmUnpair: () => void;
}

export function StylistProfileActionsOrganism({
  account,
  isPaired,
  isPendingRequest,
  audience,
  encodedPhone,
  pairId,
  canRequestPair,
  isRequestingPair,
  isBookmarked,
  isBookmarkPending,
  canBookmark,
  unpairDialogOpen,
  unpairConfirmText,
  onToggleBookmark,
  onRequestPair,
  onContact,
  contactPending,
  contactFailed = false,
  onUnpairDialogOpenChange,
  onUnpairConfirmTextChange,
  onConfirmUnpair,
}: StylistProfileActionsProps) {
  const t = useTranslations('stylist.actions');
  const tCancel = useTranslations('stylist.cancelRequest');

  // The PENDING cancel dialog (state + mutation local: less
  // prop-threading; useCancelPairRequest invalidates this stylist's accessStatus).
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  // The request's state stands in the header too, with
  // a „cancel” link (`#cancel-request`), because this section sits below the
  // gallery. The link opens THIS dialog, so the confirmation stays one.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === CANCEL_REQUEST_HASH) {
        window.history.replaceState(null, '', window.location.pathname);
        setCancelDialogOpen(true);
      }
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);
  const cancelMutation = useCancelPairRequest();

  const handleConfirmCancel = () => {
    cancelMutation.mutate(
      { stylist_account_id: account.account_id },
      { onSuccess: () => setCancelDialogOpen(false) }
    );
  };

  // The CTA phrase without inserting the name: the first word of display_name in the nominative
  // produced wrong inflection for EVERY stylist („Wpadnij do Ania"); the
  // ctaCaption key now has no placeholder.

  const actionRow = isPaired ? (
    <div className={styles.actionRow}>
      <div className={styles.pairedBadge}>
        <UserCheckIcon size={16} aria-hidden='true' />
        <span>{t('pairedBadge')}</span>
      </div>
      <LinkButtonAtom
        href={buildRoute(ROUTES_FRONT.STYLIST_GALLERY, {
          id: account.account_id,
        })}
        variant='primary'
        size='md'
        icon={<EyeIcon size={16} />}
        className={styles.actionLink}>
        {t('viewFullGallery')}
      </LinkButtonAtom>
      <LinkButtonAtom
        href={`${ROUTES_FRONT.FAVORITES}?stylist=${account.account_id}`}
        variant='outlined'
        size='md'
        icon={<BookmarkSimpleIcon size={16} />}
        className={styles.actionLink}>
        {t('savedBookmarkBtn')}
      </LinkButtonAtom>
    </div>
  ) : (
    <div className={styles.actionRow}>
      {/* CTA hierarchy: ONE primary on the screen: pairing.
       * Bookmark is always outlined; the „Zapisana" state is carried by a filled icon
       * + label (a primary after saving made two competing solids).
       * Permanent QR only: a connection request is the ONLY pairing path
       * (generated codes are removed). The PENDING state = a badge
       * instead of a button (the request is already waiting). */}
      {canBookmark && (
        <ButtonAtom
          variant='outlined'
          size='md'
          icon={
            <BookmarkSimpleIcon
              size={16}
              weight={isBookmarked ? 'fill' : 'regular'}
            />
          }
          disabled={isBookmarkPending}
          aria-busy={isBookmarkPending}
          onClick={onToggleBookmark}>
          {isBookmarked ? t('savedBookmark') : t('saveBookmark')}
        </ButtonAtom>
      )}
      {canRequestPair && isPendingRequest ? (
        // pendingBadge, NOT pairedBadge: the latter has white-space:nowrap
        // for the 1-word „Połączono"; the request-state sentence (PL ~44 chars,
        // DE ~58 chars) ran off-screen on mobile.
        // Badge + „Anuluj prośbę" (a dialog with confirmation + contact).
        <>
          <div className={styles.pendingBadge}>
            <span className={styles.lineIcon} aria-hidden='true'>
              <HourglassIcon size={16} />
            </span>
            <span>{t('requestPending')}</span>
          </div>
          {/* A standalone secondary action = outlined (ghost stays for links
              in a sentence and „anuluj” next to the primary). */}
          <ButtonAtom
            variant='outlined'
            size='md'
            icon={<XCircleIcon size={16} />}
            onClick={() => setCancelDialogOpen(true)}>
            {tCancel('trigger')}
          </ButtonAtom>
        </>
      ) : canRequestPair ? (
        <ButtonAtom
          variant='primary'
          size='md'
          icon={<UserPlusIcon size={16} />}
          disabled={isRequestingPair}
          aria-busy={isRequestingPair}
          onClick={onRequestPair}>
          {audience === 'clientOnboarding'
            ? t('completeClientAccount')
            : t('requestPair')}
        </ButtonAtom>
      ) : (
        <StylistProfileRoleActionMolecule
          audience={audience}
          onRequestPair={onRequestPair}
        />
      )}
    </div>
  );

  return (
    <>
      {isPaired ? (
        actionRow
      ) : (
        <StylistPairingExplainerMolecule
          audience={audience}
          action={actionRow}
        />
      )}
      <StylistProfileMessageActionMolecule
        audience={audience}
        pending={contactPending}
        failed={contactFailed}
        onContact={onContact}
      />
      <StylistProfileShareMolecule account={account} />

      {/* Unpair confirmation dialog */}
      <AppDialogAtom
        open={unpairDialogOpen}
        onOpenChange={onUnpairDialogOpenChange}>
        <AppDialogAtom.Content
          title={t('unpairDialog.title')}
          description={t('unpairDialog.description', {
            keyword: UNPAIR_KEYWORD,
          })}>
          <div className={styles.unpairDialogBody}>
            <div className={styles.warningBox}>
              <span className={styles.warningIcon} aria-hidden='true'>
                <WarningIcon size={20} />
              </span>
              <TypographyAtom variant='body2'>
                {t('unpairDialog.warning')}
              </TypographyAtom>
            </div>

            <InputAtom
              type='text'
              label={t('unpairDialog.inputLabel', { keyword: UNPAIR_KEYWORD })}
              placeholder={UNPAIR_KEYWORD}
              value={unpairConfirmText}
              onChange={e => onUnpairConfirmTextChange(e.target.value)}
            />
          </div>

          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={() => onUnpairDialogOpenChange(false)}>
              {t('unpairDialog.cancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              disabled={unpairConfirmText !== UNPAIR_KEYWORD}
              onClick={onConfirmUnpair}>
              {t('unpairDialog.confirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>

      {/* Cancel the PENDING request + contact the stylist (Zadzwoń / Napisz) */}
      {/* While cancelling the dialog does not close: closed in flight it vanished
          without a trace, and the request vanished a moment later (or stayed after an
          error), so the client did not know what happened. */}
      <AppDialogAtom
        open={cancelDialogOpen}
        onOpenChange={open => {
          if (!cancelMutation.isPending) {
            setCancelDialogOpen(open);
          }
        }}>
        <AppDialogAtom.Content
          title={tCancel('title')}
          closeDisabled={cancelMutation.isPending}
          description={tCancel('description')}>
          <AppDialogAtom.Body>
            <div className={styles.cancelDialogBody}>
              <TypographyAtom
                variant='body2'
                className={styles.cancelContactIntro}>
                {tCancel('contactIntro')}
              </TypographyAtom>

              {encodedPhone && (
                <StylistPhoneContactMolecule encPhone={encodedPhone} />
              )}

              {pairId && (
                <LinkButtonAtom
                  href={buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId })}
                  variant='outlined'
                  size='md'
                  icon={<ChatsCircleIcon size={16} />}
                  className={styles.cancelMessageCta}>
                  {tCancel('messageCta')}
                </LinkButtonAtom>
              )}
            </div>
          </AppDialogAtom.Body>

          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              size='md'
              disabled={cancelMutation.isPending}
              onClick={() => setCancelDialogOpen(false)}>
              {tCancel('keep')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              disabled={cancelMutation.isPending}
              aria-busy={cancelMutation.isPending}
              onClick={handleConfirmCancel}>
              {tCancel('confirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}
