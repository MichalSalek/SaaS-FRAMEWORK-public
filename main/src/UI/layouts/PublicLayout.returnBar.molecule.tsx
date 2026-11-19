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

/* ─── AppReturnBar: the way from a public page back into the app.
 *
 * DECISION: PublicLayout has no tab bar or drawer, so a public page opened from
 * the app trapped the user. The bar shows only with a live session (without one
 * `/app` bounces to login) and when either (a) she arrived FROM the app in this
 * page load (application/routing/screen-arrival.ts): history back, on every
 * platform including mobile browsers; or (b) there is no browser back (native
 * shell, `display-mode: standalone`): a link to `/app`, also after an outside
 * link. Detected after mount, so SSR renders nothing. (owner) ─── */
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
