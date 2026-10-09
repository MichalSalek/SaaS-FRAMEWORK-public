import { LP_ASSETS } from '../../assets/lpAssets';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
// UI/features/static/PricingTrialEndowment.organism.tsx
//
// Sekcja ENDOWMENT + LOSS (dźwignia konwersji, głos ownera 2026-07-12): karta
// „Masz pełne Pro, bez żadnych ograniczeń" tuż nad final CTA — po FAQ, gdy
// obiekcje rozwiane. Kadruje 30-dniowy trial jako POSIADANIE pełnego Pro
// (endowment) z jawnym anchorem strat vs Free (item1/2 „vs 5/2 na Free").
// Copy było kompletne w i18n (static.pricing.trialEndowment), lecz osierocone
// po S52 (usunięto stary duplikat trial-paragrafu) — tu podłączone jako
// zamknięta ink-karta (taste 39: statement → closed ink-card; kontrast koloru
// niesie statement, taste 13). item3 = przypięte wzory planu PRO (trial = pełne
// Pro), liczba z SSOT (max_pinned_records), nie hardcode.

import { useTranslations } from 'next-intl';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { SectionComposition } from '../../components/Section/Section.composition';
import styles from './PricingPage.module.css';

// Trial = „pełne Pro" → liczba przypiętych wzorów z limitów PRO (SSOT), nie
// literał (parytet z kartą i tabelą — jedno źródło).
const PRO_PINNED = PRICING_POLICY.LIMITS.PRO.max_pinned_records;

// Klucze pozycji w stałej kolejności (stabilny key = brak react/no-array-index).
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
          <EyebrowAtom variant='chip' className={styles.endowmentEyebrow}>
            {t('eyebrow')}
          </EyebrowAtom>
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
        {/* Aesop-restraint: pozycje jako hairline-WIERSZE on-ink (typografia +
            pełna linia, zero ikon — floor). item3 niesie liczbę wzorów PRO. */}
        <ul className={styles.endowmentList}>
          {ENDOWMENT_ITEM_KEYS.map(key => (
            <li key={key} className={styles.endowmentItem}>
              {key === 'item3' ? t(key, { count: PRO_PINNED }) : t(key)}
            </li>
          ))}
        </ul>
        <p className={styles.endowmentFootnote}>{t('footnote')}</p>
      </InkPanelAtom>
    </SectionComposition>
  );
}
