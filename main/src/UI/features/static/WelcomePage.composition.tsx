import { useEffect, useState } from 'react';
import { SquaresFourIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { detectPlatform } from '../../../application/platform/platform.detection';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import { GetAppStoreButtonsMolecule } from './GetAppStoreButtons.molecule';
import styles from './WelcomePage.module.css';

// beforeinstallprompt (Chrome/Edge na Androidzie) nie ma typu w lib.dom —
// minimalny kontrakt, którego używamy. iOS nigdy nie emituje tego zdarzenia
// (przycisk A2HS tam nie istnieje — patrz DECISION w _document.tsx).
interface A2hsPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

/**
 * WelcomePage — starter ekran (niezalogowany w apce-wrapperze; native entry
 * redirectuje `/` → tu jeszcze PRZED paintem LP, patrz zero-flash-script.ts) +
 * publiczna podstrona /welcome. Standalone, full-viewport (bez PublicLayout —
 * całość należy do tego ekranu, jak LoginPage). Floor 7×ZERO.
 *
 * Clarity-first (taste-owner 41): od pierwszego rzutu oka wiadomo GDZIE jesteś
 * (powitanie), CO zrobić (jedna oczywista primary „Wejdź do aplikacji") i gdzie
 * PODEJRZEĆ więcej (dwa wiersze z krótkim wyjaśnieniem — strona główna +
 * cennik), bez zmuszania do myślenia.
 */
export function WelcomePageComposition() {
  const t = useTranslations('static.welcome');
  // Zachęcacz instalacji TYLKO w mobile web (web-first D0, owner 2026-08-02):
  // w natywnej apce nie ma czego instalować, desktop nie jest celem sklepu.
  // Post-mount swap (wzorzec useClientStartCta) — SSR i pierwszy render bez
  // bloku, realną platformę mierzymy w efekcie, zero mismatchu SSR↔hydracja.
  const [showInstallNudge, setShowInstallNudge] = useState(false);
  useEffect(() => {
    const info = detectPlatform();
    setShowInstallNudge(!info.isNativeApp && info.isMobileDevice);
  }, []);

  // „Dodaj do ekranu głównego" (web-first D0): gdy Chrome uzna stronę za
  // instalowalną (manifest standalone, bez SW — Chrome 108+ tego nie wymaga),
  // przechwytujemy beforeinstallprompt i oferujemy instalację WŁASNYM
  // przyciskiem w zachęcaczu (preventDefault chowa mini-infobar). Zdarzenie
  // bywa emitowane przed mountem — wtedy przycisku po prostu nie ma
  // (progressive enhancement, menu przeglądarki nadal działa).
  const [a2hsPrompt, setA2hsPrompt] = useState<A2hsPromptEvent | null>(null);
  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setA2hsPrompt(e as A2hsPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () =>
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  return (
    <main className={styles.screen}>
      {/* Ten sam idiom co logowanie (owner 2026-10-08): biała karta bez ramy
          z lockupem, tytułem, jednym zdaniem i JEDNĄ wypełnioną akcją; linki
          pomocnicze to wiersze pod kartą. Wcześniej treść wisiała na papierze
          bez kotwicy, a odsyłacze były luźnymi wierszami ze strzałką „na
          zewnątrz”, innym znakiem niż w całej aplikacji. */}
      <div className={styles.card}>
        <BrandLockupMolecule
          className={styles.brandLockup}
          markClassName={styles.brandMark}
        />
        <h1 className={styles.heading}>
          {t('heading')} {t('headingAccent')}
        </h1>
        <p className={styles.lede}>{t('lede')}</p>
        <LinkButtonAtom
          direction='forward'
          href={ROUTES_FRONT.USER_LOG}
          variant='primary'
          size='lg'
          className={styles.cta}>
          {t('ctaPrimary')}
        </LinkButtonAtom>
      </div>

      <div className={styles.below}>
        <NavRowListMolecule label={t('secondaryLede')}>
          <NavRowMolecule
            href={ROUTES_FRONT.HOME}
            label={t('homeLink')}
            description={t('homeCopy')}
            trailing='chevron'
          />
          <NavRowMolecule
            href={ROUTES_FRONT.PRICING}
            label={t('pricingLink')}
            description={t('pricingCopy')}
            trailing='chevron'
          />
        </NavRowListMolecule>

        {/* Zachęcacz instalacji (mobile web): stan sklepów reużyty 1:1
            z /get-app (config-driven STORE_URLS: przed premierą Play jedno
            zdanie, po ustawieniu env żywy przycisk bez zmiany kodu). */}
        {showInstallNudge && (
          <section className={styles.installNudge}>
            <h2 className={styles.installNudgeTitle}>{t('getAppNudge')}</h2>
            <GetAppStoreButtonsMolecule />
            {a2hsPrompt && (
              <ButtonAtom
                variant='outlined'
                size='lg'
                className={styles.cta}
                icon={<SquaresFourIcon size={18} weight='regular' />}
                onClick={() => {
                  // Chrome pozwala użyć promptu tylko raz — po wywołaniu
                  // czyścimy stan (przycisk znika do następnej wizyty).
                  void a2hsPrompt.prompt();
                  setA2hsPrompt(null);
                }}>
                {t('addToHomeScreen')}
              </ButtonAtom>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
