import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './AboutPage.module.css';

/* ─── HERO — editorial split: text col left + image col right (wydzielone
   z AboutPage.tsx — eslint max-lines 300, wzór ForStylistsPageSections) ─── */
export function AboutHeroSectionOrganism() {
  const t = useTranslations('static.about');

  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.heroText}>
          <EyebrowAtom as='p' variant='chip'>
            {t('hero.eyebrowChip')}
          </EyebrowAtom>
          <h1 className={styles.heroHeadline}>
            {t('hero.headlineLine1')}{' '}
            <span className={styles.heroHeadlineAccent}>
              {t('hero.headlineAccent')}
            </span>
          </h1>
          <p className={styles.heroLede}>{t('hero.lede')}</p>
        </div>
        <div className={styles.heroImage}>
          <Image
            src={LP_ASSETS.editorial.staticSalonEntrance01}
            alt={t('hero.imageAlt')}
            fill
            style={{ objectFit: 'cover' }}
            sizes='(max-width: 767px) 100vw, 40vw'
            priority
          />
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ data — keys only (wzór OBJECTION_FAQ / PRICING_FAQ). Ten sam zestaw
   par zasila FAQPage JSON-LD w pages/about.tsx (q1-q5) — render i schema
   pozostają spójne. ─── */
const ABOUT_FAQ: { questionKey: string; answerKey: string }[] = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
];

/* ─── Timeline milestones — Vercel changelog vibe ─── */
const TIMELINE_ITEMS: {
  yearKey: string;
  titleKey: string;
  bodyKey: string;
  status: 'past' | 'present' | 'future';
}[] = [
  {
    yearKey: 'timeline.item1Year',
    titleKey: 'timeline.item1Title',
    bodyKey: 'timeline.item1Body',
    status: 'past',
  },
  {
    yearKey: 'timeline.item2Year',
    titleKey: 'timeline.item2Title',
    bodyKey: 'timeline.item2Body',
    status: 'past',
  },
  {
    yearKey: 'timeline.item3Year',
    titleKey: 'timeline.item3Title',
    bodyKey: 'timeline.item3Body',
    status: 'past',
  },
  {
    yearKey: 'timeline.item4Year',
    titleKey: 'timeline.item4Title',
    bodyKey: 'timeline.item4Body',
    status: 'present',
  },
  {
    yearKey: 'timeline.item5Year',
    titleKey: 'timeline.item5Title',
    bodyKey: 'timeline.item5Body',
    status: 'future',
  },
];

/* ─── Timeline section — zamknięta ink-karta z radiusem na jasnym tle
   (kanon taste 14, wzór pain-karty home; full-bleed ink-pas usunięty S22).
   Nagłówek + lista żyją WEWNĄTRZ panelu (jak painInner). ─── */
export function AboutTimelineSectionOrganism() {
  const t = useTranslations('static.about');

  return (
    <SectionComposition className={styles.timelineSection}>
      <InkPanelAtom tone='ink'>
        <SectionHeaderMolecule
          className={styles.timelineHeader}
          eyebrow={t('timeline.eyebrow')}
          title={t('timeline.headline')}>
          {t('timeline.lede')}
        </SectionHeaderMolecule>

        {/* Structural rail positioned relative to timelineList wrapper — must be sibling, not child of <ol> */}
        <div className={styles.timelineListWrapper}>
          <div className={styles.timelineRail} aria-hidden='true' />
          <ol className={styles.timelineList}>
            {TIMELINE_ITEMS.map((item, idx) => (
              <li
                key={item.yearKey}
                className={styles.timelineItem}
                data-status={item.status}
                style={{ animationDelay: `${idx * 60}ms` }}>
                <div className={styles.timelineMarker} aria-hidden='true'>
                  <span className={styles.timelineDot} />
                </div>
                <div className={styles.timelineContent}>
                  <span className={styles.timelineYear}>{t(item.yearKey)}</span>
                  <h3 className={styles.timelineTitle}>{t(item.titleKey)}</h3>
                  <p className={styles.timelineBody}>{t(item.bodyKey)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </InkPanelAtom>
    </SectionComposition>
  );
}

/* ─── FAQ section — kanon: FaqSection molecule. Full-bleed band (tło,
   breakout, --section-block padding) + nagłówek w skali strony
   (.pageHeadline — kanon SectionHeader ma inną skalę, parytet page-side,
   wzorzec ForStylists) zostają po stronie strony. ─── */
export function AboutFaqSectionOrganism() {
  const t = useTranslations('static.about');
  // DECISION (nie usuwaj tego komentarza):
  // static.about.faq ma tylko pary q/a (bez headline/eyebrow). Nagłówek h2 =
  // account.pay.faq.eyebrow ("Częste pytania" / "Frequent questions" /
  // "Häufige Fragen") — jedyny generyczny nagłówek FAQ istniejący we
  // wszystkich locale. Namespace 'account.pay' doładowany w pages/about.tsx
  // (loader wspiera max 2 segmenty, a pages.home.faq.headline jest w en/de
  // home-specyficzny — nie nadaje się do zapożyczenia).
  const tFaqHeading = useTranslations('account.pay.faq');

  return (
    // constrained={false} — band bez wspólnego kontenera (parytet 1:1 z formą
    // sprzed migracji na Section): nagłówek trzyma lp-content-width sam
    // (.faqSection .sectionHeader), a 72ch lista FaqSection centruje się
    // względem pełnej szerokości banda.
    <SectionComposition
      bordered
      constrained={false}
      className={styles.faqSection}
      aria-labelledby='about-faq-heading'>
      <SectionHeaderMolecule
        className={styles.faqHeader}
        title={tFaqHeading('eyebrow')}
        titleId='about-faq-heading'
      />
      <FaqSectionMolecule
        idPrefix='about-faq'
        items={ABOUT_FAQ.map(item => ({
          id: item.questionKey,
          question: t(item.questionKey),
          answer: t(item.answerKey),
        }))}
      />
    </SectionComposition>
  );
}
