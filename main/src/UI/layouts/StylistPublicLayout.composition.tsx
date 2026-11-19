import type { ReactNode } from 'react';
import { GlobeIcon } from '@phosphor-icons/react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getNextLocale,
  I18N_CONFIG,
  LOCALE_SHORT_LABELS,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import { AppLinkAtom } from '../components/AppLink/AppLink.atom';
import { BrandLockupMolecule } from '../components/BrandLockup/BrandLockup.molecule';
import { ErrorBoundaryComposition } from '../components/ErrorBoundary.composition';
import { useErrorBoundaryCopy } from '../components/useErrorBoundaryCopy';
import { useHasLiveAccountSession } from '../contexts/AuthContext.composition';
import { useHydrated } from '../hooks/useHydrated';
import { useScrollDepth } from '../hooks/useScrollDepth';
import { useInternalLinkTracking } from '../hooks/useInternalLinkTracking';
import { NavigationContentShellComposition } from './NavigationContentShell.composition';
import { AppReturnBarMolecule } from './PublicLayout.returnBar.molecule';
import { AnnouncementBannerOrganism } from '../features/announcements/AnnouncementBanner.organism';
import { MaintenanceBannerMolecule } from '../features/maintenance/MaintenanceBanner.molecule';
import { runNavigationIntent } from '../../application/routing/navigation.possibilities.api';
import styles from './StylistPublicLayout.module.css';

/** A stylist's public portfolio has its own quiet chrome; other public pages retain PublicLayout. */
export function StylistPublicLayoutComposition({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations('layout.public');
  const menu = useTranslations('menu');
  const errorCopy = useErrorBoundaryCopy();
  const hydrated = useHydrated();
  const hasLiveSession = useHasLiveAccountSession();
  const locale = (router.locale ?? I18N_CONFIG.defaultLocale) as LocaleType;
  useScrollDepth();
  useInternalLinkTracking();

  const cycleLocale = () => {
    void runNavigationIntent(
      {
        policy: 'fade',
        scroll: 'preserve',
        reason: 'locale-switch',
        targetPathname: router.asPath,
      },
      () =>
        router.push(
          { pathname: router.pathname, query: router.query },
          router.asPath,
          { locale: getNextLocale(locale), scroll: false }
        )
    );
  };

  return (
    <div className={styles.layout}>
      <a href='#main-content' className={styles.skipLink}>
        {t('skipToContent')}
      </a>
      <MaintenanceBannerMolecule />
      <AnnouncementBannerOrganism surface='public' />
      <AppReturnBarMolecule />
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <AppLinkAtom href={ROUTES_FRONT.HOME} className={styles.logo}>
            <BrandLockupMolecule />
          </AppLinkAtom>
          <div className={styles.headerActions}>
            <button
              type='button'
              className={styles.language}
              onClick={cycleLocale}
              aria-label={t('switchLanguageAriaLabel', {
                current: LOCALE_SHORT_LABELS[locale],
              })}>
              <GlobeIcon size={18} aria-hidden='true' />
              {LOCALE_SHORT_LABELS[locale]}
            </button>
            {hydrated && hasLiveSession && (
              <AppLinkAtom
                href={ROUTES_FRONT.APP}
                className={styles.accountLink}>
                {t('goToPanel')}
              </AppLinkAtom>
            )}
          </div>
        </div>
      </header>
      <main id='main-content' className={styles.content}>
        <NavigationContentShellComposition>
          <ErrorBoundaryComposition
            fallbackTitle={errorCopy.title}
            fallbackAction={errorCopy.action}
            fallbackHomeAction={errorCopy.home}>
            {children}
          </ErrorBoundaryComposition>
        </NavigationContentShellComposition>
      </main>
      <footer className={styles.footer}>
        <AppLinkAtom href={ROUTES_FRONT.PRIVACY}>{menu('privacy')}</AppLinkAtom>
        <AppLinkAtom href={ROUTES_FRONT.TERMS}>{menu('terms')}</AppLinkAtom>
      </footer>
    </div>
  );
}
