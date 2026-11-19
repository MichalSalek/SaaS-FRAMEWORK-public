/* ============================================================
 * StylistPairing — the stylist's „Połączenie” screen, permanent-QR only (owner:
 * a fixed code visible at once). The session backend stays as legacy, not in the UI.
 *
 * DECISION: this screen is TURNED TO THE CLIENT so she scans the code, so nothing
 * about other people or the stylist's business stands on it: no names, no list, no
 * client count. (1) Title "Skanuj kod QR"; the hero has no meta. (2) The code card
 * has no title or description: the code comes first, then the buttons and print
 * note. (3) The clients list and requests live on "Twoje klientki"
 * (ROUTES_FRONT.CLIENTS, StylistClientsOrganism) and do NOT return here. (4) A
 * waiting request stays reachable: ONE neutral row above the code with the count
 * alone, leading to "Twoje klientki". (5) One filled button, "Pobierz PNG"; when a
 * request waits the card gives up the fill. (6) One centred column bounded by its
 * own width. (owner)
 * ============================================================ */

import { useTranslations } from 'next-intl';
import { HandWavingIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { usePendingRequests } from '../shared/pairing/hooks/usePairRequests';
import { usePermanentCode } from '../shared/profile/usePermanentCode';
import { useMaxScreenBrightness } from '../../shared/hooks/useMaxScreenBrightness';
import { StylistPermanentCodeOrganism } from './StylistPermanentCode.organism';
import styles from './PairingPage.module.css';

export function StylistPairingOrganism() {
  const t = useTranslations('pages.pairing');
  const tButtons = useTranslations('buttons');
  // The same query and 30s poll as „Twoje klientki”: only the COUNT is read
  // here. A failed poll simply shows no row; the bell and the clients screen
  // report the failure, this screen stays a clean code.
  const pendingCount = usePendingRequests(true).data?.requests.length ?? 0;
  const code = usePermanentCode();
  // This screen IS the code a client scans (DECISION in useMaxScreenBrightness.ts).
  useMaxScreenBrightness();

  return (
    <div className={styles.page}>
      <AppHeroOrganism title={t('heroTitleStylist')} />

      <div className={styles.codeColumn}>
        {pendingCount > 0 && (
          <NavRowListMolecule ariaLabel={t('requestsTitle')}>
            <NavRowMolecule
              href={ROUTES_FRONT.CLIENTS}
              icon={<HandWavingIcon />}
              label={t('requestNotice', { count: pendingCount })}
              trailing='disc'
            />
          </NavRowListMolecule>
        )}
        <StylistPermanentCodeOrganism
          code={code}
          isMainAction={pendingCount === 0}
          retryLabel={tButtons('retry')}
          t={t}
        />
      </div>
    </div>
  );
}
