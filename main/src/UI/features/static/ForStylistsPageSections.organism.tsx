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
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
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

/* DECISION (nie usuwaj tego komentarza):
 * Listy problems/benefits NIE mają ikon-per-bullet (Aesop restraint, digest
 * distinctiveness #128) — rolę markera niesie sam serif-numeral Marcellus.
 * Ikony Phosphor zostają TYLKO w Playbook (4 kroki produktu, gdzie ikona
 * niesie sens kroku). Stąd zawężona lista importów i ten jeden icon-map. */
const PLAYBOOK_ICONS: Record<string, React.ReactNode> = {
  Image: <ImageIcon size={22} weight='regular' />,
  QrCode: <QrCodeIcon size={22} weight='regular' />,
  ShareNetwork: <ShareNetworkIcon size={22} weight='regular' />,
  Notepad: <NotepadIcon size={22} weight='regular' />,
};

/* ─── PullQuoteSection — Marcellus full-bleed breaker ─── */
/* DECISION (nie usuwaj tego komentarza):
 * Sekcja-przerywnik łamiąca rytm header→grid (digest distinctiveness #132,
 * composition #226). Reużywa istniejący klucz `problems.lede` (przeniesiony
 * TUTAJ z nagłówka sekcji problems — nie duplikat, lede zniknął z headera),
 * więc nie dodajemy nic do common.json. Wzorzec midCtaQuote z ForClients
 * uogólniony na tę stronę: full-bleed ink-violet band (B2B color-rola tej
 * strony), wielki Marcellus, jedno słowo-kotwica w złocie. */
export function ForStylistsPullQuoteSectionOrganism() {
  const t = useTranslations('static.forStylists');

  return (
    <SectionComposition
      className={styles.pullQuoteSection}
      innerClassName={styles.pullQuoteInner}
      aria-label={t('problems.headline')}>
      {/* DECISION (nie usuwaj tego komentarza):
       * Znak sekcji = ikona pędzla (rzemiosło paznokci), NIE glif cytatu.
       * Głos ownera 2026-07-19 (głosowanie /dev/playground, wariant D): tekst
       * `problems.lede` to opisowy manifest, nie cytat — znak „ mylił (cytat
       * należy do sekcji Opinie/reviews). Złoto (--color-primary), spójne z
       * manifestem About (storyQuoteIcon). NIE przywracaj „ ani nie zmieniaj
       * ikony bez nowego głosowania. */}
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
      {/* DECISION (nie usuwaj tego komentarza):
          Nagłówek tej sekcji ZOSTAJE ręcznie składany (Eyebrow + własny <h2>),
          NIE migruje na kanoniczny <SectionHeader> (FDX W5.1, celowo-różne =
          kolor). Powód: to ciemny ink-violet band (background var(--color-
          secondary)), na którym eyebrow ORAZ headline muszą być jasne (light-
          on-ink). Kanon SectionHeader hardkoduje kolory (.title →
          var(--color-text-primary), Eyebrow → własny token), a klasy są module-
          scoped — strona NIE może ich przekolorować przez kaskadę ani var-hook
          (canon nie wystawia hooka koloru). Stąd ręczny <h2 .problemsHeadline>
          (standalone, NIE .sectionHeadline — audyt eyebrow-headline-dup zakazuje
          definicji .sectionHeadline) + <Eyebrow .eyebrowInk> (color-only). */}
      <header className={styles.sectionHeader}>
        <EyebrowAtom as='p' variant='chip' className={styles.eyebrowInk}>
          {t('problems.eyebrow')}
        </EyebrowAtom>
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
        {PROBLEMS_DATA.map((p, idx) => (
          <div key={p.n} className={styles.problemPair} data-scroll-reveal>
            <div className={styles.problemSide}>
              <EyebrowAtom
                as='p'
                variant='chip'
                className={styles.problemSceneLabel}>
                {t(`problems.scene${String(idx + 1)}Label`)}
              </EyebrowAtom>
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
          eyebrow={t('playbook.eyebrow')}
          eyebrowVariant='chip'
          title={t('playbook.headline')}>
          {t('playbook.lede')}
        </SectionHeaderMolecule>
      </SectionOrnamentMolecule>
      {/* DECISION (nie usuwaj tego komentarza):
          Playbook items NIE migrują na FeatureCardMolecule. Topline ma
          icon-chip (44px złoty chip) ORAZ duży dekoracyjny numeral
          (.playbookNumber) ułożone justify-content:space-between — to
          dwuslotowy topline (icon + numeral), podczas gdy FeatureCard ma 1
          slot icon. Wymuszenie mapping icon+numeral na FeatureCard wymagałoby
          złożonego `icon` ReactNode z obu elementów lub utraty numeralu.
          Ponadto .playbookNumber ma a11y-safe oklch (3.5:1 PASS large-text,
          skomentowane w CSS) — kanoniczny FeatureCard nie wystawia hooka
          koloru numeralu. Zostaje oryginalna implementacja jako pixel-parity
          SSOT dla tego wzorca. */}
      <div className={styles.playbookGrid}>
        {STYLIST_PLAYBOOK.map((item, idx) => (
          // id = cel `url` kroków HowTo w JSON-LD (#playbook-step-N) — bez
          // kotwicy schema wskazywała nieistniejące fragmenty strony.
          <article
            key={item.n}
            id={`playbook-step-${idx + 1}`}
            className={styles.playbookItem}>
            <div className={styles.playbookTopline}>
              <span className={styles.playbookIcon} aria-hidden='true'>
                {PLAYBOOK_ICONS[item.iconName]}
              </span>
              {/* Numeral jako pseudo-content (CSS ::before attr(data-num)), nie
                  tekst w spanie — textContent sklejal sie w copy-paste i
                  SERP-snippetach ("1Dodaj zdjecia..."). */}
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
        eyebrow={t('benefitsSection.eyebrow')}
        eyebrowVariant='chip'
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
          {/* Realny dowód produktu w (dotąd pustej) prawej kolumnie listy:
              screen galerii z filtrami spina się z b01/b07. Tylko ≥768 —
              na mobile dowód niesie triptych poniżej (bez przeładowania). */}
          <aside className={styles.benefitsProof}>
            <PhoneMockupMolecule
              label={t('benefitsSection.mockup1Label')}
              route='/app/gallery'
              state={t('benefitsSection.mockup1State')}
              size='lg'
              screenshot={appScreen('appGalleryFeed')}
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
      {/* Showcase 3 screenów na ink-stage z focal-swap (głos S35 B+C):
          pełnoszerokościowy negatyw przełamuje kolumnę, hover/tap przenosi
          powiększenie. „Za darmo" jako kicker-kotwica (ZD-3). */}
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

/* PricingPreviewSection → ForStylistsPageSections.b.organism (ekstrakcja S44,
 * max-lines; wzorzec 1:1 z for-studios). */
