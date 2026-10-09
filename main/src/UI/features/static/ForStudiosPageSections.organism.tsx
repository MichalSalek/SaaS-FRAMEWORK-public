import { useTranslations } from 'next-intl';
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
    /* S36 (głos ownera A · ink-negatyw): „Salon jako marka" przeniesione na
       pełnoszerokościowy ciemny negatyw (--color-ink, mode-invariant) — przełamuje
       „nudną kolumnę" KOLOREM + SZEROKOŚCIĄ, równa siatka 2×2 ZOSTAJE (gust
       „równość = jakość"). Header przez kanon SectionHeader + var-hooki
       on-ink (--eyebrow-color / --section-headline-color / --section-lede-color). */
    <SectionComposition tone='plain' className={styles.benefitsSection}>
      <SectionHeaderMolecule
        className={styles.benefitsInkHead}
        eyebrow={t('benefits.eyebrow')}
        eyebrowVariant='chip'
        title={t('benefits.headline')}>
        {t('benefits.lede')}
      </SectionHeaderMolecule>
      <div className={styles.benefitsList}>
        {BENEFITS.map(b => (
          <article
            key={b.titleKey}
            className={styles.benefit}
            data-scroll-reveal>
            {/* Jeden układ ikon dla wszystkich wpisów: kafelek NAD tytułem
                (wcześniej ikona w linii tytułu łamała się losowo przy
                zawijaniu — raz obok, raz nad). Numeracja 01-04 usunięta
                (Style Policy §6 — równoległe feature'y, nie kroki). */}
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
/* Karta roli — forma 1:1 jak dotychczas (S24 głosowanie 4, wariant A =
   karty DZIŚ bez zmian, dochodzi tylko konektor drzewa w sekcji).
   DECISION (nie usuwaj tego komentarza):
   Migracja na FeatureCard DIVERGENT: featured karta (owner) nosi SOLID
   primary color-block + editorial split 2-col grid desktop + sparkle ::before
   pseudo-element + on-ink icon tile + skalowane kolory meta/title/body.
   Non-featured karty (team, client) pasują do FeatureCard strukturalnie, ale
   migracja częściowa (2/3 kart) tworzy niespójność w OperatingCard funkcji
   (featured hand-rolled + non-featured FeatureCard). Cały OperatingCard
   zostaje hand-rolled dla spójności. Migracja feasible po ewentualnym
   rozszerzeniu FeatureCard o featured-variant (var-hook lub data-attr). */
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
        <span className={styles.operatingMeta}>{t(item.metaKey)}</span>
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
        eyebrow={t('operating.eyebrow')}
        eyebrowVariant='plain'
        title={t('operating.headline')}>
        {t('operating.lede')}
      </SectionHeaderMolecule>
      {/* Drzewo organizacyjne (S24 głosowanie 4, wariant A): featured
          karta (Właścicielka) pełną szerokością, hairline-konektor
          (stem → rail → drops), para kart (Zespół / Klientki) niżej. */}
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

/* ─── FaqSection — akordeon przez kanoniczny molecule components/FaqSection
   (strona nie nosi własnego słownika klas FAQ). Nagłówek zostaje page-side
   przez kanoniczny <SectionHeader> w skali strony (var-hook
   .sectionHeaderScaled — FDX W5.1), spójny z pozostałymi sekcjami strony;
   <FaqSection> dostaje sam akordeon (headingId wpięty w titleId nagłówka). ─── */
export function ForStudiosFaqSectionOrganism() {
  const t = useTranslations('static.forStudios');

  // as='div' + bordered: FaqSection molecule sam renderuje <section>,
  // a tint-band strony nosi pełną ramę hairline przez prop.
  return (
    <SectionComposition as='div' bordered className={styles.faqSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        eyebrow={t('faq.eyebrow')}
        eyebrowVariant='plain'
        title={t('faq.headline')}
        titleId='studios-faq-heading'
      />
      <FaqSectionMolecule
        headingId='studios-faq-heading'
        idPrefix='studios-faq'
        items={FAQ.map(item => ({
          id: item.questionKey,
          question: t(item.questionKey),
          answer: t(item.answerKey),
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
