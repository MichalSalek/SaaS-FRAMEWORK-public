// StylistPermanentCode — karta stałego kodu QR stylistki (plakat, naklejka
// przy stanowisku, wizytówka). Sam widok: stan i trzy drogi dystrybucji
// (pobranie, natywny share, link) trzyma hooks/usePermanentCode.
//
// DECISION: the card has NO title or description ("czysty kod QR"). The client looks at this screen
// and the screen title ("Skanuj kod QR") already says everything; "Twój stały kod" and the print
// instruction above the code were removed. The print note stands UNDER the buttons and stays.
// (owner)

import { type useTranslations } from 'next-intl';
import {
  DownloadSimpleIcon,
  LinkIcon,
  ShareNetworkIcon,
} from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { CardMolecule } from '../../components/Card/Card.molecule';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import type { PermanentCode } from '../shared/profile/usePermanentCode';
import styles from './PairingPage.module.css';

type PairingPageT = ReturnType<typeof useTranslations<'pages.pairing'>>;

export function StylistPermanentCodeOrganism({
  code,
  isMainAction,
  retryLabel,
  t,
}: {
  code: PermanentCode;
  /**
   * The download is the screen's one filled action, unless a connection
   * request is waiting: then the request row above the card is the thing to
   * tap and this steps back.
   */
  isMainAction: boolean;
  retryLabel: string;
  t: PairingPageT;
}) {
  const lang = useCurrentLang();

  // The error state is a surface of its own, so it REPLACES the card instead
  // of sitting inside it (no box in a box).
  if (code.status === 'error') {
    return (
      <ErrorStateMolecule
        message={t('permanentLoadError')}
        retryLabel={retryLabel}
        onRetry={code.retry}
        isRetrying={code.isRetrying}
      />
    );
  }

  // Loading and ready render the SAME structure (frame, actions, note): the
  // card keeps its height while the account and the QR arrive, the buttons
  // only wake up.
  const isReady = code.status === 'ready';
  const hasQr = isReady && code.qrDataUrl !== '';

  return (
    <CardMolecule variant='outlined'>
      <div className={styles.codeCard}>
        <div className={styles.qrFrame}>
          {hasQr ? (
            <img
              src={code.qrDataUrl}
              alt={t('permanentQrAlt')}
              className={styles.qrImage}
              width={220}
              height={220}
            />
          ) : (
            <SkeletonAtom variant='rect' width={220} height={220} />
          )}
        </div>

        <div className={styles.codeActions}>
          <ButtonAtom
            variant={isMainAction ? 'primary' : 'outlined'}
            size='md'
            icon={<DownloadSimpleIcon size={18} weight='regular' />}
            onClick={() => void code.download()}
            disabled={!hasQr}
            className='press-feedback'>
            {t('permanentDownloadBtn')}
          </ButtonAtom>
          <div className={styles.codeActionsSecondary}>
            {code.canNativeShare && (
              <ButtonAtom
                variant='outlined'
                size='md'
                icon={<ShareNetworkIcon size={18} weight='regular' />}
                onClick={() => void code.share()}
                disabled={!isReady}
                className='press-feedback'>
                {t('shareCodeBtn')}
              </ButtonAtom>
            )}
            <ButtonAtom
              variant='outlined'
              size='md'
              icon={<LinkIcon size={18} weight='regular' />}
              onClick={() => void code.copyLink()}
              disabled={!isReady}
              className='press-feedback'>
              {t('copyLinkBtn')}
            </ButtonAtom>
          </div>
        </div>

        <p className={styles.codeNote} lang={lang}>
          {t('permanentPrintHint')}
        </p>
      </div>
    </CardMolecule>
  );
}
