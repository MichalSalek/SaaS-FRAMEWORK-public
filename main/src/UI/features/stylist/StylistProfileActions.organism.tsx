import { useState, useEffect } from 'react';
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
import { ShareButtonAtom } from '../../components/ShareButton/ShareButton.atom';
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
  /** Stały kod QR (2026-07-11): prośba PENDING czeka na akceptację stylistki. */
  isPendingRequest: boolean;
  /** O1: telefon stylistki zakodowany PII (server-side) — CTA „Zadzwoń" w dialogu
   *  anulowania prośby. null gdy stylistka nie podała numeru. */
  encodedPhone?: string | null | undefined;
  /** O1: id pary PENDING — klucz wejścia do komunikatora („Napisz do stylistki")
   *  z dialogu anulowania. null gdy nieznane. */
  pairId?: string | null | undefined;
  /** Prośba o połączenie to client-only endpoint: CTA widzi klientka i gość
   *  (jako droga do logowania); stylist-mode sesja dostaje pair-by-QR jak dotąd. */
  canRequestPair: boolean;
  isRequestingPair: boolean;
  isBookmarked: boolean;
  /** Mutacja zakładki w locie — przycisk nie przyjmuje drugiego kliku. */
  isBookmarkPending: boolean;
  /** Bookmarking a stylist is CLIENT-only (BOOKMARK_STYLIST). When false (logged
   *  out, or a stylist-mode session) the bookmark CTA is hidden — non-clients get
   *  pair-by-QR + share only, never a button that 403s. */
  canBookmark: boolean;
  unpairDialogOpen: boolean;
  unpairConfirmText: string;
  onToggleBookmark: () => void;
  onRequestPair: () => void;
  onUnpairDialogOpenChange: (open: boolean) => void;
  onUnpairConfirmTextChange: (text: string) => void;
  onConfirmUnpair: () => void;
}

export function StylistProfileActionsOrganism({
  account,
  isPaired,
  isPendingRequest,
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
  onUnpairDialogOpenChange,
  onUnpairConfirmTextChange,
  onConfirmUnpair,
}: StylistProfileActionsProps) {
  const t = useTranslations('stylist.actions');
  const tCancel = useTranslations('stylist.cancelRequest');
  const fallback = useTranslations('labels')('stylistFallback');

  // Adres BEZ query i hasha: wejście z plakatu niesie `?from=qr`, a link
  // udostępniony dalej z tym parametrem liczył każde otwarcie jako skan QR
  // (lejek `stylist_profile_qr_scan`) i przenosił cudze utm-y. Liczone per
  // profil: nawigacja profil → profil nie montuje strony od nowa, więc efekt
  // bez zależności udostępniał adres POPRZEDNIEJ stylistki.
  const [shareUrl, setShareUrl] = useState('');
  useEffect(() => {
    setShareUrl(`${window.location.origin}${window.location.pathname}`);
  }, [account.account_id]);

  // O1: dialog anulowania prośby PENDING (stan + mutacja lokalne — mniej
  // prop-threadingu; useCancelPairRequest invaliduje accessStatus tej stylistki).
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const cancelMutation = useCancelPairRequest();

  const handleConfirmCancel = () => {
    cancelMutation.mutate(
      { stylist_account_id: account.account_id },
      { onSuccess: () => setCancelDialogOpen(false) }
    );
  };

  // Fraza CTA bez wstawiania nazwy: pierwsze słowo display_name w mianowniku
  // produkowało błędną fleksję dla KAŻDEJ stylistki („Wpadnij do Ania" — census
  // S26); klucz ctaCaption jest teraz bez placeholdera.

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
      {/* S76: wejście do komunikatora dla POŁĄCZONEJ pary — bez tego
          klientka nie miała ŻADNEJ drogi do napisania pierwszej
          wiadomości (lista rozmów pokazuje tylko wątki z wiadomościami,
          a jedyny link do wątku żył w dialogu anulowania prośby). */}
      {pairId && (
        <LinkButtonAtom
          href={buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId })}
          variant='outlined'
          size='md'
          icon={<ChatsCircleIcon size={16} />}
          className={styles.actionLink}>
          {t('messageStylist')}
        </LinkButtonAtom>
      )}
    </div>
  ) : (
    <div className={styles.actionRow}>
      {/* Hierarchia CTA (census S26): JEDEN primary na ekranie — parowanie.
       * Bookmark zawsze outlined; stan „Zapisana" niesie wypełniona ikona
       * + label (primary po zapisaniu robił dwa konkurujące solidy).
       * Stały-only (2026-07-12): prośba o połączenie to JEDYNA ścieżka
       * parowania (generowane kody usunięte). Stan PENDING = badge
       * zamiast przycisku (prośba już czeka). */}
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
        // pendingBadge, NIE pairedBadge: tamten ma white-space:nowrap
        // pod 1-słowo „Połączono" — zdanie stanu prośby (PL ~44 zn.,
        // DE ~58 zn.) wyjeżdżało poza ekran na mobile (review S51).
        // O1: badge + „Anuluj prośbę" (dialog z potwierdzeniem + kontaktem).
        <>
          <div className={styles.pendingBadge}>
            <span className={styles.lineIcon} aria-hidden='true'>
              <HourglassIcon size={16} />
            </span>
            <span>{t('requestPending')}</span>
          </div>
          {/* Samodzielna akcja drugorzędna = outlined (ghost zostaje linkom
              w zdaniu i „anuluj” obok primary). */}
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
          {t('requestPair')}
        </ButtonAtom>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Action buttons. „Udostępnij” stoi pod rzędem akcji w swojej
          naturalnej szerokości (klasa `shareAction`): sekcja jest kolumną,
          która rozciągała go od krawędzi do krawędzi (owner 2026-10-08). */}
      <section className={styles.section}>
        {actionRow}
        <ShareButtonAtom
          url={shareUrl}
          title={account.display_name || account.business_name || fallback}
          text={t('shareText')}
          className={styles.shareAction}
        />
      </section>

      <StylistPairingExplainerMolecule
        isPaired={isPaired}
        isPendingRequest={isPendingRequest}
        canRequestPair={canRequestPair}
      />

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

      {/* O1: anuluj prośbę PENDING + kontakt ze stylistką (Zadzwoń / Napisz) */}
      {/* W trakcie anulowania dialog się nie zamyka: zamknięty w locie znikał
          bez śladu, a prośba i tak znikała chwilę później (albo zostawała po
          błędzie), więc klientka nie wiedziała, co się stało. */}
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
