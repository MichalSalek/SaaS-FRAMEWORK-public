import { useLocale, useMessages, useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  UsersIcon,
  UserCheckIcon,
  PaperPlaneTiltIcon,
  ChartLineIcon,
} from '@phosphor-icons/react';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { BENEFITS, FAQ, OPERATING_ITEMS } from './ForStudiosPageData';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import styles from './ForStudiosPage.module.css';
import type { IntlMessages } from '../../../types/i18n';
import { createStudioFaqAnswerFormatter } from './ForStudiosPageFaq';

/* ─── Icon map ─── */
const BENEFIT_ICONS: Record<string, React.ReactNode> = {
  Users: <UsersIcon size={22} weight='regular' />,
  UserCheck: <UserCheckIcon size={22} weight='regular' />,
  PaperPlaneTilt: <PaperPlaneTiltIcon size={22} weight='regular' />,
  ChartLine: <ChartLineIcon size={22} weight='regular' />,
};

/* ─── BenefitsSection ─── */
export function ForStudiosBenefitsSectionOrganism() {
  const t = useTranslations('static.forStudios');

  return (
    /* Owner: the „Salon jako marka" section uses a full-width ink surface to
       break the column rhythm. The 2×2 grid remains; the header uses
       SectionHeader's on-ink headline and lede hooks. (owner) */
    <SectionComposition tone='plain' className={styles.benefitsSection}>
      <SectionHeaderMolecule
        className={styles.benefitsInkHead}
        title={t('benefits.headline')}>
        {t('benefits.lede')}
      </SectionHeaderMolecule>
      <div className={styles.benefitsList}>
        {BENEFITS.map(b => (
          <article
            key={b.titleKey}
            className={styles.benefit}
            data-scroll-reveal>
            {/* One icon layout for every entry: the tile sits above the title.
                An icon in the title line used to wrap at random, beside the
                title or above it. Numbers 01-04 are gone (Style Policy §6:
                parallel features, not steps). */}
            <span className={styles.benefitIcon} aria-hidden='true'>
              {BENEFIT_ICONS[b.iconName]}
            </span>
            <div className={styles.benefitContent}>
              <h3 className={styles.benefitTitle}>{t(b.titleKey)}</h3>
              <p className={styles.benefitText}>{t(b.bodyKey)}</p>
            </div>
          </article>
        ))}
      </div>
      <ProcessIllustrationMolecule
        src={LP_ASSETS.process.stylistPortfolio}
        alt={t('benefits.portfolioAlt')}
        className={styles.benefitsIllustration}
      />
    </SectionComposition>
  );
}

/* ─── OperatingSection ─── */
/* Role card, same shape as before (owner vote: today's cards, only the tree connector is added).
   DECISION: OperatingCard stays hand-rolled instead of using FeatureCard. The featured (owner) card
   diverges structurally (solid primary block, 2-column split on desktop, on-ink icon tile), and
   migrating only the two plain cards would split one component across two implementations. Migrate
   all three only after FeatureCard gains a featured variant. */
function OperatingCard({
  item,
  featured,
}: {
  item: (typeof OPERATING_ITEMS)[number];
  featured?: boolean;
}) {
  const t = useTranslations('static.forStudios');

  return (
    <article
      className={styles.operatingItem}
      data-featured={featured ? 'true' : undefined}>
      <div className={styles.operatingHead}>
        <span className={styles.operatingIcon} aria-hidden='true'>
          {BENEFIT_ICONS[item.iconName]}
        </span>
      </div>
      <div className={styles.operatingContent}>
        <h3 className={styles.operatingTitle}>{t(item.titleKey)}</h3>
        <p className={styles.operatingBody}>{t(item.bodyKey)}</p>
      </div>
    </article>
  );
}

export function ForStudiosOperatingSectionOrganism() {
  const t = useTranslations('static.forStudios');
  const [owner, team, client] = OPERATING_ITEMS;

  return (
    <SectionComposition className={styles.operatingSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('operating.headline')}>
        {t('operating.lede')}
      </SectionHeaderMolecule>
      {/* Org chart: the featured owner card is full width, then a hairline
          connector (stem, rail, drops), then the pair (team and clients). */}
      <div className={styles.operatingStack}>
        <OperatingCard item={owner} featured />
        <div className={styles.operatingConnector} aria-hidden='true'>
          <span className={styles.operatingStem} />
          <span className={styles.operatingRail} />
          <span className={styles.operatingDropLeft} />
          <span className={styles.operatingDropRight} />
        </div>
        <div className={styles.operatingPair}>
          <OperatingCard item={team} />
          <OperatingCard item={client} />
        </div>
      </div>
    </SectionComposition>
  );
}

/* FAQ accordion uses the canonical FaqSection molecule. The page keeps no
   FAQ class dictionary. The heading stays page-side through SectionHeader
   at the page scale (.sectionHeaderScaled), consistent with the other
   sections. FaqSection receives only the accordion (headingId on the title). */
export function ForStudiosFaqSectionOrganism() {
  const t = useTranslations('static.forStudios');
  const messages = useMessages() as unknown as IntlMessages;
  const locale = useLocale();
  const formatAnswer = createStudioFaqAnswerFormatter(messages, locale);

  // as='div' + bordered: FaqSection molecule sam renderuje <section>,
  // a tint-band strony nosi pełną ramę hairline przez prop.
  return (
    <SectionComposition as='div' bordered className={styles.faqSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('faq.headline')}
        titleId='studios-faq-heading'
      />
      <FaqSectionMolecule
        headingId='studios-faq-heading'
        idPrefix='studios-faq'
        items={FAQ.map(item => ({
          id: item.questionKey,
          question: t(item.questionKey),
          answer: formatAnswer(item.answerKey),
        }))}
      />
    </SectionComposition>
  );
}

/* ─── Re-export new sections from .b.tsx for backward compatibility ─── */
export {
  ForStudiosTrustStripSectionOrganism,
  ForStudiosUseCasesSectionOrganism,
  ForStudiosPricingTierPreviewSectionOrganism,
} from './ForStudiosPageSections.b.organism';
