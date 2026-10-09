/* ============================================================
 * StylistPairing — ekran Połączenie stylistki, wersja STAŁY-ONLY
 * (decyzja ownera 2026-07-12: „najprostsza wersja — stały kod, od razu
 * widoczny; koniec z generowanym 15-min"). Audyt zależności przed
 * przeróbką: generowane PairingSession żyły wyłącznie we własnej domenie
 * (issue/claim/revoke/cleanup) — sesje inspiracji (SessionContainer) i cała
 * reszta wymagają tylko ACTIVE pary, która powstaje z prośby po stałym
 * kodzie. Backend sesyjny zostaje jako legacy (nieeksponowany w UI).
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-09, ZASTĘPUJE
 * decyzję z 2026-10-08 (hero z liczbami, prośby nad kodem, lista klientek
 * w drugiej kolumnie):
 *
 * Ten ekran stylistka ODWRACA DO KLIENTKI, żeby ta zeskanowała kod („widzi go
 * również klientka”). Nie stoi więc na nim nic o innych ludziach ani
 * o interesach stylistki: żadnych imion, żadnej listy, żadnej liczby klientek.
 *
 * 1. Tytuł ekranu to „Skanuj kod QR” i mówi do osoby, która patrzy. Hero nie
 *    ma meta (ani liczby klientek, ani liczby próśb).
 * 2. Karta kodu nie ma tytułu ani opisu: pierwszą rzeczą w karcie jest kod.
 *    Przyciski i uwaga o druku pod nimi zostają.
 * 3. Lista klientek i prośby o połączenie mieszkają na „Twoje klientki”
 *    (ROUTES_FRONT.CLIENTS, StylistClientsOrganism): własna trasa, własna
 *    pozycja w menu. Tutaj NIE wracają, także jako pusty stan.
 * 4. Prośba jest dalszym ciągiem akcji tego ekranu (klientka skanuje, prośba
 *    dochodzi w ciągu 30 s istniejącym odpytywaniem), więc zostaje stąd
 *    osiągalna: JEDEN neutralny wiersz nad kodem, tylko gdy coś czeka, z samą
 *    liczbą i bez imienia, prowadzący na „Twoje klientki”.
 * 5. Jeden wypełniony przycisk: „Pobierz PNG”. Gdy prośba czeka, karta oddaje
 *    wypełnienie, a jedyną rzeczą wołającą o dotknięcie jest wiersz prośby.
 * 6. Jedna kolumna, wyśrodkowana i ograniczona własną szerokością (nie
 *    progiem viewportu): nie ma już niczego, co stałoby obok kodu.
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
import { usePermanentCode } from './hooks/usePermanentCode';
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
