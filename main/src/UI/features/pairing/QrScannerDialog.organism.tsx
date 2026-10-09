/* ============================================================
 * QrScannerDialog — skaner kodu QR stylistki, w aplikacji.
 *
 * DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-09:
 * Model parowania zostaje bez zmian (stały kod QR prowadzi na publiczny profil
 * stylistki, klientka wysyła stamtąd prośbę o połączenie) — zmienia się DROGA.
 * Do tej pory jedyną drogą był systemowy aparat telefonu, a ekran „Połącz"
 * mówił o nim tylko słowem: „nie wiem, jak się mam połączyć… każda aplikacja
 * ma swoje skanowanie". Skaner NIE jest drugim mechanizmem parowania: dekoduje
 * ten sam URL, wyciąga z niego identyfikator profilu i wysyła DOKŁADNIE tę samą
 * prośbę co przycisk na profilu. Systemowy aparat działa jak działał.
 *
 * Dekodowanie dwutorowo (silnik: hooks/useQrScanner), bo dwa tory pokrywają
 * dwie połowy rynku:
 *   • `BarcodeDetector` — natywny w Chrome/Android i w Android WebView, zero
 *     kosztu w bundlu, dekoduje najszybciej;
 *   • `jsqr` — ładowany LENIWIE i tylko wtedy, gdy pierwszego nie ma (Safari na
 *     iPhonie, czyli cała ścieżka „web-first D0" na iOS).
 * Kamera idzie przez `getUserMedia`, więc działa też bez pluginu natywnego —
 * skorupa nie musi być przebudowana, żeby to ruszyło.
 * ============================================================ */

import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { QrCodeIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useRequestPair } from '../shared/pairing/hooks/usePairRequests';
import type { ScannerPhase } from './hooks/useQrScanner';
import { useQrScanner } from './hooks/useQrScanner';
import styles from './QrScannerDialog.module.css';

interface QrScannerDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Fazy, w których podgląd kamery COKOLWIEK pokazuje.
 *
 * DECISION (nie usuwaj tego komentarza): `denied` i `unsupported` są poza tym
 * zbiorem, bo w nich strumienia nie ma i nigdy nie będzie bez nowej zgody —
 * kwadrat 350x350 atramentu z celownikiem zajmował wtedy 41% wysokości arkusza
 * i obiecywał obraz, którego nie było. `notFound` zostaje: kamera żyje, kobieta
 * dalej celuje, a komunikat mówi tylko, że TEN kod był nie ten.
 */
const CAMERA_PHASES: readonly ScannerPhase[] = [
  'starting',
  'scanning',
  'lookingUp',
  'notFound',
  'lookupFailed',
];

/** Tytuł idzie za fazą — arkusz „znalazłam stylistkę" nie może wołać „zeskanuj kod". */
const TITLE_KEY_BY_PHASE: Record<ScannerPhase, string> = {
  starting: 'title',
  scanning: 'title',
  lookingUp: 'title',
  found: 'titleFound',
  denied: 'titleDenied',
  unsupported: 'titleUnsupported',
  notFound: 'titleNotFound',
  lookupFailed: 'titleLookupFailed',
};

export function QrScannerDialogOrganism({
  open,
  onClose,
}: QrScannerDialogProps) {
  const t = useTranslations('pages.pairing.scanner');
  const queryClient = useQueryClient();
  const requestPair = useRequestPair();
  const { phase, found, videoRef, canvasRef, rescan, restart } =
    useQrScanner(open);

  /* Wynik trzymamy w JEDNEJ zmiennej zawężonej do nie-nulla: faza `found` bez
   * `found` nie istnieje w silniku, ale TS o tym nie wie, a `phase && found`
   * w dwóch miejscach rozjeżdżało się przy każdej zmianie warunku. */
  const result = phase === 'found' ? found : null;
  const showCamera = CAMERA_PHASES.includes(phase);
  const hasPrimaryAction =
    result !== null ||
    phase === 'denied' ||
    phase === 'notFound' ||
    phase === 'lookupFailed';

  const handleSendRequest = () => {
    if (!found) {
      return;
    }
    requestPair.mutate(
      { stylist_account_id: found.accountId },
      {
        onSuccess: response => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.pairing.all,
          });
          pushNewSnackbar(
            response.status === 'ALREADY_PAIRED'
              ? t('alreadyPaired', { name: found.displayName })
              : t('requestSent', { name: found.displayName }),
            'success'
          );
          onClose();
        },
      }
    );
  };

  return (
    <AppDialogAtom
      open={open}
      // „Zamknij" is disabled while the request is in flight; the backdrop, ESC
      // and the swipe must follow it, otherwise the sheet vanished mid-send and
      // the result toast arrived out of nowhere.
      disablePointerDismissal={requestPair.isPending}
      onOpenChange={next => {
        if (!next && !requestPair.isPending) {
          onClose();
        }
      }}>
      <AppDialogAtom.Content
        title={t(TITLE_KEY_BY_PHASE[phase])}
        className={styles.popup}>
        {result !== null ? (
          <div className={styles.result}>
            <AvatarAtom
              src={result.avatarUrl ?? undefined}
              name={result.displayName || '?'}
              size='lg'
            />
            <TypographyAtom variant='h3'>{result.displayName}</TypographyAtom>
            {result.city !== null && result.city !== '' && (
              <TypographyAtom
                variant='body2'
                color='var(--color-text-secondary)'>
                {result.city}
              </TypographyAtom>
            )}
            <TypographyAtom variant='body2'>{t('confirmBody')}</TypographyAtom>
            {/* A standalone secondary action, so it wears the quiet fill; the
                bare-text variant is kept for „Zamknij” next to the filled
                button in the footer. */}
            <ButtonAtom
              variant='outlined'
              size='sm'
              onClick={rescan}
              disabled={requestPair.isPending}>
              {t('scanAgain')}
            </ButtonAtom>
          </div>
        ) : (
          <div
            className={`${styles.stage}${showCamera ? '' : ` ${styles.stageMessageOnly}`}`}>
            {showCamera && (
              <div className={styles.viewport}>
                <video
                  ref={videoRef}
                  className={styles.video}
                  playsInline
                  muted
                  aria-label={t('cameraAriaLabel')}
                />
                <div className={styles.reticle} aria-hidden='true' />
              </div>
            )}
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              aria-hidden='true'
            />

            <div className={styles.status} role='status'>
              {(phase === 'starting' || phase === 'scanning') && (
                <>
                  <span className={styles.statusIcon} aria-hidden='true'>
                    <QrCodeIcon size={20} />
                  </span>
                  <span>{phase === 'starting' ? t('starting') : t('aim')}</span>
                </>
              )}
              {phase === 'lookingUp' && <span>{t('lookingUp')}</span>}
              {(phase === 'denied' ||
                phase === 'unsupported' ||
                phase === 'notFound' ||
                phase === 'lookupFailed') && (
                <>
                  <span className={styles.statusIcon} aria-hidden='true'>
                    <WarningCircleIcon size={20} />
                  </span>
                  <span>{t(phase)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* DECISION (nie usuwaj tego komentarza): stopka jest RENDEROWANA W
         * KAŻDEJ FAZIE i zawsze zaczyna się od „Zamknij". Bez niej arkusz był
         * pułapką: popup zajmuje cały ekran telefonu (390x844 od 0,0), więc
         * tapnięcie „obok" trafia w popup, a nie w zasłonę, `body` ma
         * `overflow: hidden`, w skorupie natywnej nie ma paska adresu ani
         * klawisza ESC — po odmowie zgody na kamerę nie było już ŻADNEGO
         * wyjścia. Zamknięcie idzie przez `onClose` (jak w
         * ClientFreeSlotDialog), czyli `open=false` -> cleanup efektu w
         * useQrScanner -> `stopCamera()` gasi ścieżki kamery i zwalnia dzierżawę
         * jasności. Nie zamieniaj tego na zamknięcie „tylko wizualne". */}
        <AppDialogAtom.Actions>
          {/* One filled action per phase. „Zamknij” is bare text when it stands
              next to it (a cancel beside a primary) and wears the quiet fill
              when it is the only button of the sheet. */}
          <ButtonAtom
            variant={hasPrimaryAction ? 'text' : 'outlined'}
            size='md'
            onClick={onClose}
            disabled={requestPair.isPending}>
            {t('close')}
          </ButtonAtom>
          {result !== null && (
            <ButtonAtom
              variant='primary'
              size='md'
              onClick={handleSendRequest}
              aria-busy={requestPair.isPending}
              disabled={requestPair.isPending}>
              {requestPair.isPending ? t('sending') : t('sendRequest')}
            </ButtonAtom>
          )}
          {phase === 'denied' && (
            <ButtonAtom variant='primary' size='md' onClick={restart}>
              {t('retryCamera')}
            </ButtonAtom>
          )}
          {(phase === 'notFound' || phase === 'lookupFailed') && (
            <ButtonAtom variant='primary' size='md' onClick={rescan}>
              {t('scanAgain')}
            </ButtonAtom>
          )}
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
