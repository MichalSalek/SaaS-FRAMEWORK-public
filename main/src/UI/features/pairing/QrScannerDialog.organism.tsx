/* ============================================================
 * QrScannerDialog — the in-app scanner of a stylist's QR code.
 *
 * DECISION: the pairing model is unchanged (the permanent QR code leads to the stylist's public
 * profile, where the client sends a connection request); only the PATH changes. The scanner is
 * NOT a second pairing mechanism: it decodes the same URL, extracts the profile identifier and
 * sends EXACTLY the same request as the button on the profile; the system camera still works.
 * Decoding has two tracks (engine: hooks/useQrScanner) to cover both halves of the market:
 * `BarcodeDetector` (native in Chrome/Android and Android WebView, no bundle cost, fastest) and
 * `jsqr`, loaded LAZILY only when the first is absent (Safari on iPhone). The camera goes
 * through `getUserMedia`, so it needs no native plugin and the shell need not be rebuilt. (owner)
 * ============================================================ */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { QrCodeIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useRequestPair } from '../shared/pairing/hooks/usePairRequests';
import { usePairNameGate } from '../shared/pairing/usePairNameGate';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import type { ScannerPhase } from './hooks/useQrScanner';
import { useQrScanner } from './hooks/useQrScanner';
import styles from './QrScannerDialog.module.css';

interface QrScannerDialogProps {
  open: boolean;
  onClose: () => void;
  onRequestResult?: (result: {
    name: string;
    connected: boolean;
    created: boolean;
  }) => void;
}

/**
 * Phases in which the camera preview shows ANYTHING.
 *
 * DECISION: `denied` and `unsupported` are outside this set because there is no stream and never
 * will be without a new permission: a 350x350 ink square with a reticle then took 41% of the sheet
 * height and promised an image that did not exist. `notFound` stays: the camera is alive, she keeps
 * aiming, and the message only says that THIS code was not the right one.
 */
/** Phases that end a scan attempt without a stylist; each is reported once. */
const FAILED_PHASES: readonly ScannerPhase[] = [
  'denied',
  'unsupported',
  'notFound',
  'lookupFailed',
];

const CAMERA_PHASES: readonly ScannerPhase[] = [
  'starting',
  'scanning',
  'lookingUp',
  'notFound',
  'lookupFailed',
];

/** The title follows the phase: a „found a stylist” sheet must not shout „scan the code”. */
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
  onRequestResult,
}: QrScannerDialogProps) {
  const t = useTranslations('pages.pairing.scanner');
  const tLabels = useTranslations('labels');
  const queryClient = useQueryClient();
  const requestPair = useRequestPair();
  const { data: account } = useCurrentUserAccount();
  const nameGate = usePairNameGate(account?.name, {
    ownStylistDisplayName: account?.stylist_account?.display_name,
  });
  const { phase, found, videoRef, canvasRef, rescan, restart } =
    useQrScanner(open);

  /* Flow trace: one event per opening and per phase change. The refs hold the
   * last reported value, so a StrictMode double effect never counts twice. The
   * phase seen at opening is the previous opening's leftover (the scanner
   * resets it in its own effect), so it is recorded, never reported. */
  const trackedOpenRef = useRef(false);
  const trackedPhaseRef = useRef<ScannerPhase | null>(null);
  useEffect(() => {
    if (!open) {
      trackedOpenRef.current = false;
      trackedPhaseRef.current = null;
      return;
    }
    if (!trackedOpenRef.current) {
      trackedOpenRef.current = true;
      trackedPhaseRef.current = phase;
      trackFlowStep('pairing', 'scanner_opened');
      return;
    }
    if (trackedPhaseRef.current === phase) {
      return;
    }
    trackedPhaseRef.current = phase;
    if (phase === 'found') {
      trackFlowStep('pairing', 'scan_succeeded');
    } else if (FAILED_PHASES.includes(phase)) {
      trackFlowStep('pairing', 'scan_failed', { phase });
    }
  }, [open, phase]);

  /* The result is held in ONE variable narrowed to non-null: the `found` phase
   * without `found` does not exist in the engine, but TS does not know that,
   * and `phase && found` in two places drifted apart on every condition change. */
  const result = phase === 'found' ? found : null;
  // A stylist onboarded with the role alone has no name yet: the heading,
  // the avatar and the confirmation sentence all read the same fallback.
  const foundName = found?.displayName || tLabels('stylistFallback');
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
    nameGate.run(() =>
      requestPair.mutate(
        { stylist_account_id: found.accountId },
        {
          onSuccess: response => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.pairing.all,
            });
            onRequestResult?.({
              name: foundName,
              connected: response.status === 'ALREADY_PAIRED',
              created: response.status !== 'ALREADY_PAIRED' && response.created,
            });
            onClose();
          },
        }
      )
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
              name={foundName}
              size='lg'
            />
            <TypographyAtom variant='h3'>{foundName}</TypographyAtom>
            {result.city !== null && result.city !== '' && (
              <TypographyAtom
                variant='body2'
                color='var(--color-text-secondary)'>
                {result.city}
              </TypographyAtom>
            )}
            <TypographyAtom variant='body2'>{t('confirmBody')}</TypographyAtom>
            {/* What she shares by connecting; the same sentence stands on the
                stylist's public profile (DECISION in
                StylistPairingExplainer.molecule.tsx). */}
            <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
              {t('confirmShared')}
            </TypographyAtom>
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

        {/* DECISION: the footer is RENDERED IN EVERY PHASE and always starts with "Zamknij".
            Without it the sheet was a trap: the popup fills the whole phone screen (390x844
            from 0,0), so a tap "outside" hits the popup, not the backdrop, `body` has
            `overflow: hidden`, and the native shell has no address bar or ESC key: after
            denying the camera permission there was NO exit at all. Closing goes through
            `onClose` (as in ClientFreeSlotDialog), i.e. `open=false` -> effect cleanup in
            useQrScanner -> `stopCamera()` stops the camera tracks and releases the brightness
            lease. Do not replace this with a "visual only" close. */}
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
      {nameGate.dialog}
    </AppDialogAtom>
  );
}
