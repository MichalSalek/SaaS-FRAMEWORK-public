// UI/layouts/PublicLayout.returnBar.molecule.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLinkAtom as Link } from '../components/AppLink/AppLink.atom';
import { useHasLiveAccountSession } from '../contexts/AuthContext.composition';
import { detectPlatform } from '../../application/platform/platform.detection';
import { cameFromRoutePrefix } from '../../application/routing/screen-arrival';
import { useNativeRouter } from './useNativeRouter';
import { useScreenArrival } from './useScreenArrival';
import styles from './PublicLayout.module.css';

/* ─── AppReturnBar — wyjście z powierzchni publicznej z powrotem do apki.
 *
 * DECISION (nie usuwaj tego komentarza) — zgłoszenia ownera 2026-09-09
 * i 2026-10-09:
 * Strony publiczne (publiczny profil stylistki, regulamin, pomoc) renderują
 * PublicLayout, który NIE ma dolnej belki ani szuflady. Wejście tam z aplikacji
 * („Twój publiczny profil” → „Zobacz profil”) kończyło się uwięzieniem: „już
 * nie mogę stamtąd wyjść”, „nie mogę wrócić do ustawień, w których byłem”.
 * Ten pasek jest stałym wyjściem. Pokazuje się przy żywej sesji (bez niej
 * `/app` odbija na login, a pasek udawałby drogę do produktu), gdy zachodzi
 * jedno z dwojga:
 *  - przyszła tu Z APLIKACJI w tym załadowaniu strony (ślad nawigacji,
 *    application/routing/screen-arrival.ts): pasek cofa dokładnie tam, skąd
 *    przyszła, na każdej platformie. Do 2026-10-09 przeglądarka telefonu
 *    była pominięta („ma własny wstecz”), a owner testował właśnie w niej;
 *  - nie ma przeglądarkowego „wstecz”: skorupa natywna albo aplikacja
 *    z ekranu głównego (`display-mode: standalone`). Wtedy pasek prowadzi do
 *    `/app` także po wejściu z linku z zewnątrz.
 * Detekcja po montażu, więc na SSR pasek nie istnieje i nie ma mismatchu. ─── */
export function AppReturnBarMolecule() {
  const t = useTranslations('layout.public');
  const router = useRouter();
  const nav = useNativeRouter();
  const hasLiveSession = useHasLiveAccountSession();
  const arrival = useScreenArrival(router.pathname, false);
  const [hasNoBrowserBack, setHasNoBrowserBack] = useState(false);

  useEffect(() => {
    setHasNoBrowserBack(
      detectPlatform().isNativeApp ||
        window.matchMedia('(display-mode: standalone)').matches
    );
  }, []);

  const cameFromApp = cameFromRoutePrefix(arrival, ROUTES_FRONT.APP);
  if (!hasLiveSession || (!cameFromApp && !hasNoBrowserBack)) {
    return null;
  }

  const content = (
    <>
      <ArrowLeftIcon size={16} weight='bold' aria-hidden='true' />
      <span>{t('backToApp')}</span>
    </>
  );
  return (
    <div className={styles.returnBar}>
      {cameFromApp ? (
        <button
          type='button'
          className={styles.returnBarLink}
          onClick={() => nav.back()}>
          {content}
        </button>
      ) : (
        <Link href={ROUTES_FRONT.APP} className={styles.returnBarLink}>
          {content}
        </Link>
      )}
    </div>
  );
}
