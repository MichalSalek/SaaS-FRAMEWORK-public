import { LP_ASSETS } from '../../assets/lpAssets';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
// Trial benefits are explained without repeating demo restrictions. Full conditions
// remain in pricing details and the actual activation flow.

import { useTranslations } from 'next-intl';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { SectionComposition } from '../../components/Section/Section.composition';
import styles from './PricingPage.module.css';

// Trial = „pełne Pro" → the number of pinned designs from the PRO limits (SSOT), not a
// literal (parity with the card and the table: one source).
const PRO_PINNED = PRICING_POLICY.LIMITS.PRO.max_pinned_records;

// Item keys in a fixed order (a stable key = no react/no-array-index).
const ENDOWMENT_ITEM_KEYS = [
  'item1',
  'item2',
  'item3',
  'item4',
  'item5',
] as const;

export function PricingTrialEndowmentOrganism() {
  const t = useTranslations('static.pricing.trialEndowment');

  return (
    <SectionComposition className={styles.endowmentSection}>
      <InkPanelAtom
        tone='ink'
        as='section'
        ariaLabelledby='pricing-endowment-heading'
        className={styles.endowmentPanel}>
        <div className={styles.endowmentHead}>
          <h2 id='pricing-endowment-heading' className={styles.endowmentTitle}>
            {t('title')}
          </h2>
          <p className={styles.endowmentIntro}>{t('intro')}</p>
          <ProcessIllustrationMolecule
            src={LP_ASSETS.contextual.pricing}
            alt={t('pageIllustrationAlt')}
            width={1500}
            height={1000}
            sizes='(max-width: 767px) 100vw, 500px'
            className={styles.contextualIllustration}
          />
        </div>
        {/* Aesop restraint: items as on-ink hairline ROWS (typography +
            a full line, zero icons, floor). item3 carries the number of PRO designs. */}
        <ul className={styles.endowmentList}>
          {ENDOWMENT_ITEM_KEYS.map(key => (
            <li key={key} className={styles.endowmentItem}>
              {key === 'item3' ? t(key, { count: PRO_PINNED }) : t(key)}
            </li>
          ))}
        </ul>
      </InkPanelAtom>
    </SectionComposition>
  );
}
