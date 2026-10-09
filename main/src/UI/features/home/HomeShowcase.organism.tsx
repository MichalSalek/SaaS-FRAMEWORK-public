import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useTranslations } from 'next-intl';
import { InteractivePhoneStageOrganism } from '../../components/InteractivePhoneStage/InteractivePhoneStage.organism';
import { useAppScreenshots } from '../../assets/useAppScreenshots';

/**
 * Showcase: 3 ekrany aplikacji na ink-stage z focal-swap (głos ownera S35 B+C —
 * pełnoszerokościowy ciemny negatyw przełamuje „nudną kolumnę"; hover/tap przenosi
 * powiększenie). Wyłamane z HomePage.composition (proof produktu po korzyściach).
 */
export function HomeShowcaseOrganism() {
  const t = useTranslations('pages.home');
  const appScreen = useAppScreenshots();
  return (
    <InteractivePhoneStageOrganism
      ariaLabel={t('benefits.mockupsAriaLabel')}
      screens={[
        {
          label: t('benefits.mockup2Label'),
          route: '/app/gallery',
          state: t('benefits.mockup2State'),
          screenshot: appScreen('appGalleryFeed'),
        },
        {
          label: t('benefits.mockup3Label'),
          route: ROUTES_FRONT.CLIENT_CARD,
          state: t('benefits.mockup3State'),
          screenshot: appScreen('appClientCard'),
        },
        {
          label: t('benefits.mockup4Label'),
          route: '/app/pairing',
          state: t('benefits.mockup4State'),
          screenshot: appScreen('appPairingRequests'),
        },
      ]}
    />
  );
}
