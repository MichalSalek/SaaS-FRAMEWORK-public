import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import clsx from 'clsx';
import {
  ImageIcon,
  QrCodeIcon,
  ShareNetworkIcon,
  NotepadIcon,
  PaintBrushIcon,
} from '@phosphor-icons/react';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { InteractivePhoneStageOrganism } from '../../components/InteractivePhoneStage/InteractivePhoneStage.organism';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import {
  PROBLEMS_DATA,
  BENEFITS_DATA,
  STYLIST_PLAYBOOK,
} from './ForStylistsPageData';
import styles from './ForStylistsPage.module.css';

/* DECISION: the problems and benefits lists carry no per-item icons; Phosphor icons
 * appear only in the Playbook steps, where the icon carries the step's meaning. */
const PLAYBOOK_ICONS: Record<string, React.ReactNode> = {
  Image: <ImageIcon size={22} weight='regular' />,
  QrCode: <QrCodeIcon size={22} weight='regular' />,
  ShareNetwork: <ShareNetworkIcon size={22} weight='regular' />,
  Notepad: <NotepadIcon size={22} weight='regular' />,
};

/* ─── PullQuoteSection — Marcellus full-bleed breaker ─── */
/* Rhythm breaker between header-and-grid sections. It renders `problems.lede`, which
 * moved here from the problems header (not a duplicate). */
export function ForStylistsPullQuoteSectionOrganism() {
  const t = useTranslations('static.forStylists');

  return (
    <SectionComposition
      className={styles.pullQuoteSection}
      innerClassName={styles.pullQuoteInner}
      aria-label={t('problems.headline')}>
      {/* DECISION: the section mark is a paint brush, never a quote glyph: the text is
       * a manifesto, not a quote (quotes belong to the reviews section). Do not change
       * the icon without a new vote. Its placement: DECISION at `.pullQuoteInner` in
       * ForStylistsPage.module.css. (owner) */}
      <PaintBrushIcon
        size={56}
        weight='fill'
        className={styles.pullQuoteMark}
        aria-hidden='true'
      />
      <p className={styles.pullQuote}>{t('problems.lede')}</p>
    </SectionComposition>
  );
}

/* ─── ProblemsSection ─── */
export function ForStylistsProblemsSectionOrganism() {
  const t = useTranslations('static.forStylists');

  return (
    <SectionComposition className={styles.problemsSection}>
      {}
      <header className={styles.sectionHeader}>
        <h2 className={styles.problemsHeadline}>{t('problems.headline')}</h2>
      </header>
      <ProcessIllustrationMolecule
        src={LP_ASSETS.contextual.stylists}
        alt={t('pageIllustrationAlt')}
        width={1500}
        height={1000}
        sizes='(max-width: 768px) 100vw, 672px'
        className={styles.contextualIllustration}
      />
      <div className={styles.problemsList}>
        {PROBLEMS_DATA.map(p => (
          <div key={p.n} className={styles.problemPair} data-scroll-reveal>
            <div className={styles.problemSide}>
              <h3 className={styles.problemTitle}>{t(p.problemKey)}</h3>
              <p className={styles.solutionText}>{t(p.solutionKey)}</p>
            </div>
          </div>
        ))}
      </div>
    </SectionComposition>
  );
}

/* ─── PlaybookSection ─── */
export function ForStylistsPlaybookSectionOrganism() {
  const t = useTranslations('static.forStylists');

  return (
    <SectionComposition className={styles.playbookSection}>
      <SectionOrnamentMolecule
        src={LP_ASSETS.decor.phoneGalleryOutline}
        className={styles.playbookHeading}>
        <SectionHeaderMolecule
          className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
          title={t('playbook.headline')}>
          {t('playbook.lede')}
        </SectionHeaderMolecule>
      </SectionOrnamentMolecule>
      {/* DECISION: playbook items do not migrate to FeatureCardMolecule. Their topline
          has two slots (icon chip plus a decorative numeral, space-between) while
          FeatureCard has one icon slot; forcing it would merge both into one `icon`
          node or lose the numeral. */}
      <div className={styles.playbookGrid}>
        {STYLIST_PLAYBOOK.map((item, idx) => (
          // id = the `url` target of the HowTo steps in JSON-LD (#playbook-step-N);
          // without the anchor the schema pointed at fragments that do not exist.
          <article
            key={item.n}
            id={`playbook-step-${idx + 1}`}
            className={styles.playbookItem}>
            <div className={styles.playbookTopline}>
              <span className={styles.playbookIcon} aria-hidden='true'>
                {PLAYBOOK_ICONS[item.iconName]}
              </span>
              {/* Numeral as pseudo-content (CSS ::before attr(data-num)), not text
                  in a span: textContent glued together in copy-paste and SERP
                  snippets ("1Add photos..."). */}
              <span
                className={styles.playbookNumber}
                data-num={item.n}
                aria-hidden='true'
              />
            </div>
            <h3 className={styles.playbookTitle}>{t(item.titleKey)}</h3>
            <p className={styles.playbookBody}>{t(item.bodyKey)}</p>
            <p className={styles.playbookMeta}>{t(item.metaKey)}</p>
          </article>
        ))}
      </div>
      <ProcessIllustrationMolecule
        src={LP_ASSETS.process.clientConnection}
        alt={t('playbook.connectionProcessAlt')}
        className={styles.processIllustration}
      />
    </SectionComposition>
  );
}

/* ─── BenefitsSection ─── */
export function ForStylistsBenefitsSectionOrganism() {
  const t = useTranslations('static.forStylists');
  const appScreen = useAppScreenshots();
  const textBenefits = BENEFITS_DATA.filter(b => !b.highlight);
  const highlightBenefit = BENEFITS_DATA.find(b => b.highlight);

  return (
    <SectionComposition tone='subtle' className={styles.benefitsSection}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        title={t('benefitsSection.headline')}>
        {t('benefitsSection.lede')}
      </SectionHeaderMolecule>
      <div className={styles.benefitsBordered}>
        <div className={styles.benefitsSplit}>
          <div className={styles.benefitsList}>
            {textBenefits.map(b => (
              <article key={b.n} className={styles.benefit} data-scroll-reveal>
                <div className={styles.benefitContent}>
                  <h3 className={styles.benefitTitle}>
                    {t(b.titleKey)}
                    {b.detailKey && (
                      <span className={styles.benefitDetail}>
                        {t(b.detailKey)}
                      </span>
                    )}
                  </h3>
                  <p className={styles.benefitText}>{t(b.bodyKey)}</p>
                </div>
              </article>
            ))}
          </div>
          {/* Real product proof in the right column of the list: the gallery
              screen with filters ties to b01/b07. Only from 768px, on mobile
              the triptych below carries the proof (no overload). */}
          <aside className={styles.benefitsProof}>
            <PhoneMockupMolecule
              label={t('benefitsSection.mockup1Label')}
              route='/app/gallery'
              state={t('benefitsSection.mockup1State')}
              size='lg'
              screenshot={appScreen('appGalleryWide')}
            />
          </aside>
        </div>
        {highlightBenefit && (
          <article className={styles.benefit} data-highlight data-scroll-reveal>
            <div className={styles.benefitContent}>
              <h3 className={styles.benefitTitle}>
                {t(highlightBenefit.titleKey)}
              </h3>
              <p className={styles.benefitText}>
                {t(highlightBenefit.bodyKey)}
              </p>
              <div className={styles.benefitHighlightAnchor} aria-hidden='true'>
                <span className={styles.benefitHighlightFigure}>
                  {t('benefitsSection.highlightFigure')}
                </span>
                <span className={styles.benefitHighlightLabel}>
                  {t('benefitsSection.highlightLabel')}
                </span>
              </div>
            </div>
          </article>
        )}
      </div>
      {/* Three screens on an ink stage with focal swap: a full-width
          negative breaks the column; hover and tap move the enlargement. */}
      <InteractivePhoneStageOrganism
        screens={[
          {
            label: t('benefitsSection.mockup1Label'),
            route: '/app/gallery',
            state: t('benefitsSection.mockup1State'),
            screenshot: appScreen('appGalleryFeed'),
          },
          {
            label: t('benefitsSection.mockup2Label'),
            route: ROUTES_FRONT.SESSION_DETAIL,
            state: t('benefitsSection.mockup2State'),
            screenshot: appScreen('appInboxSession'),
          },
          {
            label: t('benefitsSection.mockup3Label'),
            route: ROUTES_FRONT.MESSAGES_THREAD,
            state: t('benefitsSection.mockup3State'),
            screenshot: appScreen('appThread'),
          },
        ]}
      />
    </SectionComposition>
  );
}

/* PricingPreviewSection lives in ForStylistsPageSections.b.organism (extracted
 * for max-lines; 1:1 pattern with for-studios). */
