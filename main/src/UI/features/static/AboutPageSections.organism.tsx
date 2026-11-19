import { useTranslations } from 'next-intl';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import styles from './AboutPage.module.css';

/* ─── FAQ data — keys only (the OBJECTION_FAQ / PRICING_FAQ pattern). The same set of
   pairs feeds FAQPage JSON-LD in pages/about.tsx (q1-q5), so render and schema
   stay consistent. ─── */
const ABOUT_FAQ = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
] as const satisfies readonly { questionKey: string; answerKey: string }[];

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

/* ─── Timeline section — a closed ink card with a radius on a light background
   (taste canon 14, the home pain-card pattern; the full-bleed ink band was removed).
   Header + list live INSIDE the panel (like painInner). ─── */
export function AboutTimelineSectionOrganism() {
  const t = useTranslations('static.about');

  return (
    <SectionComposition className={styles.timelineSection}>
      <InkPanelAtom tone='ink'>
        <SectionHeaderMolecule
          className={styles.timelineHeader}
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

/* ─── FAQ section — canon: the FaqSection molecule. The full-bleed band (background,
   breakout, --section-block padding) + a header at the page scale (.pageHeadline;
   the SectionHeader canon has a different scale, page-side parity, the ForStylists
   pattern) stay on the page's side. ─── */
export function AboutFaqSectionOrganism() {
  const t = useTranslations('static.about');
  // DECISION: static.about.faq holds only q/a pairs, so the h2 borrows
  // account.pay.faq.eyebrow, the only generic FAQ heading in all locales
  // (pages.home.faq.headline is home-specific in en/de). 'account.pay.faq' is in
  // the '/about' contract of page-messages.config.ts.
  const tFaqHeading = useTranslations('account.pay.faq');

  return (
    // constrained={false}: a band with no shared container (1:1 parity with the
    // form before the migration to Section): the header holds lp-content-width
    // itself (.faqSection .sectionHeader), and the 72ch FaqSection list centres
    // against the band's full width.
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
