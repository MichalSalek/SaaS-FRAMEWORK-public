import { useEffect, useState } from 'react';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { SquaresFourIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { detectPlatform } from '../../../application/platform/platform.detection';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { BrandMarkAtom } from '../../components/BrandMark/BrandMark.atom';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { BrandDecisionFrameOrganism } from '../../components/BrandDecisionFrame/BrandDecisionFrame.organism';
import styles from './WelcomePage.module.css';

// beforeinstallprompt (Chrome/Edge on Android) has no type in lib.dom; this is
// the minimal contract we use. iOS never emits the event
// (the A2HS button does not exist there; see the DECISION in _document.tsx).
interface A2hsPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

/** A short, centred app entry. Product details stay on the public pages. */
export function WelcomePageComposition() {
  const t = useTranslations('static.welcome');
  const { clearPricingFunnel } = usePricingFunnelState();
  // The install nudge ONLY on mobile web (web-first, owner):
  // a native app has nothing to install, desktop is not a store target.
  // A post-mount swap (the useClientStartCta pattern): SSR and the first render have no
  // block, the real platform is measured in an effect, zero SSR-hydration mismatch.
  const [showInstallNudge, setShowInstallNudge] = useState(false);
  useEffect(() => {
    const info = detectPlatform();
    setShowInstallNudge(!info.isNativeApp && info.isMobileDevice);
  }, []);

  // „Dodaj do ekranu głównego" (web-first): when Chrome deems the page
  // installable (standalone manifest; Chrome 108+ does not require a SW for it),
  // we intercept beforeinstallprompt and offer installation with our OWN
  // button in the nudge (preventDefault hides the mini-infobar). The event
  // may fire before mount, then the button is simply absent
  // (progressive enhancement, the browser menu still works).
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
    <BrandDecisionFrameOrganism
      as='main'
      variant='welcome'
      intro={
        <>
          <h1 className={styles.heading}>
            <span className={styles.visuallyHidden}>{t('heading')} </span>
            <span className={styles.wordmark}>{t('headingAccent')}</span>
          </h1>
          <p className={styles.lede}>{t('lede')}</p>
        </>
      }>
      <BrandMarkAtom className={styles.brandMark} sizes='128px' />
      <div className={styles.actions}>
        <p className={styles.demo}>{t('betaEvidence')}</p>
        <LinkButtonAtom
          direction='forward'
          href={`${ROUTES_FRONT.USER_LOG}?intent=register`}
          onClick={clearPricingFunnel}
          variant='primary'
          size='lg'
          className={styles.cta}>
          {t('ctaPrimary')}
        </LinkButtonAtom>
        <AppLinkAtom href={ROUTES_FRONT.USER_LOG} className={styles.login}>
          {t('ctaLogin')}
        </AppLinkAtom>
        <nav className={styles.info} aria-label={t('secondaryLede')}>
          <AppLinkAtom href={ROUTES_FRONT.HOME}>{t('homeLink')}</AppLinkAtom>
          <AppLinkAtom href={ROUTES_FRONT.PRICING}>
            {t('pricingLink')}
          </AppLinkAtom>
        </nav>
        {showInstallNudge && a2hsPrompt && (
          <ButtonAtom
            variant='outlined'
            size='md'
            icon={<SquaresFourIcon size={18} weight='regular' />}
            onClick={() => {
              void a2hsPrompt.prompt();
              setA2hsPrompt(null);
            }}>
            {t('addToHomeScreen')}
          </ButtonAtom>
        )}
      </div>
    </BrandDecisionFrameOrganism>
  );
}
