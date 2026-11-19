import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useTranslations } from 'next-intl';
import { InteractivePhoneStageOrganism } from '../../components/InteractivePhoneStage/InteractivePhoneStage.organism';
import { useAppScreenshots } from '../../assets/useAppScreenshots';

/**
 * Showcase: 3 app screens on an ink stage with a focal swap (owner). A
 * full-width dark negative breaks the „nudną kolumnę"; hover/tap moves the
 * enlargement. Split out of HomePage.composition (product proof after benefits).
 *
 * DECISION: screens must "explain themselves" (owner). The QR-code-only screen is gone
 * ("nie pokazuj po prostu kodu QR"); in its place stands a conversation with a client before the
 * visit, and the client card has a filled note and real-sounding visit notes in the demo data. The
 * order tells one visit: gallery, conversation, client card. (owner)
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
          label: t('benefits.conversationLabel'),
          route: ROUTES_FRONT.MESSAGES,
          state: t('benefits.conversationState'),
          screenshot: appScreen('appThread'),
        },
        {
          label: t('benefits.mockup3Label'),
          route: ROUTES_FRONT.CLIENT_CARD,
          state: t('benefits.mockup3State'),
          screenshot: appScreen('appClientCard'),
        },
      ]}
    />
  );
}
