import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { InteractivePhoneStageOrganism } from '../../components/InteractivePhoneStage/InteractivePhoneStage.organism';
import { TrustProseMolecule } from '../../components/TrustProse/TrustProse.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { PricingComparisonTableOrganism } from './PricingComparisonTable.organism';
import styles from './PricingPage.module.css';

/**
 * Trust + VAT + opcjonalny slot (kotwica Booksy). Owner 2026-08-19:
 * żyje na dole sekcji „Porównaj plany", nie pod kartami planów.
 * Screeny = `PricingTiersMockupsOrganism` (osobny ink-stage PO porównaniu).
 */
interface PricingTiersTrustFooterProps {
  afterTrust?: ReactNode;
}

export function PricingCompareChapterOrganism({
  afterTrust,
}: PricingTiersTrustFooterProps) {
  return (
    <PricingComparisonTableOrganism
      footer={<PricingTiersTrustFooterOrganism afterTrust={afterTrust} />}
    />
  );
}

export function PricingTiersTrustFooterOrganism({
  afterTrust,
}: PricingTiersTrustFooterProps) {
  const t = useTranslations('static.pricing');

  return (
    <div className={styles.comparisonTrustFooter}>
      <div className={styles.tiersTrustWrap}>
        <TrustProseMolecule
          sentence={t.rich('tierSection.trustProse', {
            em: chunks => <em>{chunks}</em>,
          })}
          note={t('tierSection.vatNote')}
        />
      </div>
      {afterTrust}
    </div>
  );
}

/** Ink-stage 3 screenów. Osobna sekcja pod porównaniem (owner 2026-08-19). */
export function PricingTiersMockupsOrganism() {
  const t = useTranslations('static.pricing');
  const appScreen = useAppScreenshots();

  return (
    <InteractivePhoneStageOrganism
      screens={[
        {
          label: t('tierSection.mockup1Label'),
          route: '/app/gallery',
          state: t('tierSection.mockup1State'),
          screenshot: appScreen('appGalleryFeed'),
        },
        {
          label: t('tierSection.mockup2Label'),
          route: '/app/sessions',
          state: t('tierSection.mockup2State'),
          screenshot: appScreen('appClientSessions'),
        },
        {
          label: t('tierSection.mockup3Label'),
          route: '/app/messages',
          state: t('tierSection.mockup3State'),
          screenshot: appScreen('appThread'),
        },
      ]}
    />
  );
}
