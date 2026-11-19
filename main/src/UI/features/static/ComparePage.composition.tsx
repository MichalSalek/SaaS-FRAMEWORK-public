import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { InkPanelAtom } from '../../components/InkPanel/InkPanel.atom';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { CompareHeroVerdictMolecule } from './CompareHeroVerdict.molecule';
import { PhoneQuoteStripOrganism } from '../../components/PhoneQuoteStrip/PhoneQuoteStrip.organism';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import {
  COMPARE_TABLE_ROWS,
  COMPARE_CONTRAST_SECTIONS,
  COMPARE_FAQ,
} from './ComparePageData';
import styles from './ComparePage.module.css';
import { splitKeyword } from './ComparePage.helpers';
import { CompareTableFooterMolecule } from './CompareTableFooter.molecule';
import {
  trackCtaClick,
  withSignupTracking,
} from '../../../application/analytics/cta-events';
import { CtaFootnoteWithPriceMolecule } from '../shared/pricing/CtaFootnoteWithPrice.molecule';

/* ─── Social statement: the statement and the screen sit together in the ink panel
 * (the negative makes a break in the page rhythm, gold accents the keyword).
 * Booking and pinterest stay plain typography. ─── */
function SocialStatementInkPanel() {
  const t = useTranslations('static.compare');
  const { lead, keyword, trailing } = splitKeyword(t('social.headline'));
  return (
    <div className={styles.inkInner}>
      <InkPanelAtom tone='ink'>
        <div className={styles.inkSplit}>
          <div className={styles.inkContent}>
            <SectionHeaderMolecule
              className={styles.inkHeader}
              title={
                <>
                  {lead} <span className={styles.inkAccent}>{keyword}</span>
                  {trailing}
                </>
              }
            />
            <div className={styles.inkBody}>
              <p>{t('social.body1')}</p>
              <p>{t('social.body2')}</p>
            </div>
            <p className={styles.inkProof}>{t('social.proof')}</p>
          </div>
          <ProcessIllustrationMolecule
            src={LP_ASSETS.contextual.home}
            alt={t('social.illustrationAlt')}
            className={styles.socialIllustration}
          />
        </div>
      </InkPanelAtom>
    </div>
  );
}

/* ─── ComparePage — Nailfolio vs Booksy/Fresha/Instagram/Pinterest ─── */
export function ComparePageComposition() {
  const t = useTranslations('static.compare');
  const appScreen = useAppScreenshots();

  // Free-first (owner, DOMAIN_SSOT §18): the signup CTA clears any
  // stale plan intent (useFreeSignupCta), so onboarding activates Free with no
  // plan step; the Pro trial is offered in the app at the moment of value.
  // DECISION: see main/src/UI/features/static/AboutPage.composition.tsx (signup CTA, no
  // /get-app bounce).
  const goToSignup = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`
  );

  // Compare is a long conversion page (the table plus three contrasts). Like the
  // sibling landing pages it gets a sticky bottom CTA, so the "Nailfolio wygrywa"
  // decision has a button in reach without scrolling to the final CTA (mobile +15-25%).
  const showStickyCta = useShowOnScroll();

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO — kanon: LpHero molecule (gold-italic akcent) ─── */}
        {/* DECISION: see main/src/UI/components/LpHero/LpHero.organism.tsx (`lead` is the SEO
            <h1>, no label above the headline). */}
        <LpHeroOrganism
          className={styles.compareHero}
          shimmerCta
          lead={t('hero.lead')}
          headline={t('hero.headlineLine1')}
          headlineAccent={t('hero.headlineAccent')}
          lede={t('hero.lede')}
          media={<CompareHeroVerdictMolecule />}
          actions={
            <>
              <ButtonAtom
                direction='forward'
                variant='primary'
                size='lg'
                onClick={withSignupTracking('compare-hero', goToSignup)}>
                {t('hero.ctaPrimary')}
              </ButtonAtom>
              <AppParagraphLinkAtom
                href={ROUTES_FRONT.FOR_STYLISTS}
                onClick={() => trackCtaClick('compare-stylists-link')}
                className={styles.heroSecondaryLink}>
                {t('hero.ctaSecondary')}
              </AppParagraphLinkAtom>
            </>
          }
        />

        {/* ─── 1b. PROOF — PhoneQuoteStrip: one sentence above the table places
            the product against booking tools. The form matches the playground;
            the copy comes from i18n. ─── */}
        <SectionComposition tone='white'>
          <PhoneQuoteStripOrganism
            phone={{
              label: t('phoneQuote.phoneLabel'),
              route: ROUTES_FRONT.CLIENT_SESSION_DETAIL,
              screenshot: appScreen('appClientSessionDetail'),
            }}
            quoteTitle={t.rich('phoneQuote.title', {
              em: chunks => <em>{chunks}</em>,
            })}
            quoteBody={t('phoneQuote.body')}
            /* Wyciągnięcie „pamięci o klientce" z 4. wiersza tabeli do
               proof-regionu pod hero (review r16): ten sam bundle-SSOT
               (rowMemoryNailfolio) eksponowany jako konkret, nie zakopany. */
            quoteFacts={t('table.rowMemoryNailfolio')}
          />
        </SectionComposition>

        {/* ─── 2. COMPARISON TABLE — band (breakout + kontener lp) =
            Section; tint tła (color-mix, nie bg-subtle) zostaje page-side
            w .tableSection. ─── */}
        <SectionComposition className={styles.tableSection}>
          <SectionHeaderMolecule
            className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
            title={t('table.headline')}>
            {t('table.lede')}
          </SectionHeaderMolecule>

          {/* Desktop: semantic comparison table (>=768px) */}
          <div className={styles.tableWrapper}>
            <table className={styles.compareTable}>
              <thead>
                <tr>
                  {/* Empty corner cell — row headers live in tbody th[scope=row] */}
                  <td />
                  <th scope='col'>{t('table.colBooking')}</th>
                  <th scope='col'>{t('table.colSocial')}</th>
                  <th scope='col' className={styles.highlightCol}>
                    {t('table.colNailfolio')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_TABLE_ROWS.map(row => (
                  <tr key={row.labelKey}>
                    <th scope='row'>{t(row.labelKey)}</th>
                    <td>{t(row.bookingKey)}</td>
                    <td>{t(row.socialKey)}</td>
                    <td className={styles.highlightCol}>
                      {t(row.nailfolioKey)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: one card per tool (<768px). Nailfolio is FIRST — it is
                the product we are selling; competitor cards come after.
                Pattern: PricingComparisonTable mobile card layout (1:1). */}
          <ul className={styles.compareCards}>
            {/* ── Nailfolio (target) — first, gold-tinted ── */}
            <li className={`${styles.compareCard} ${styles.compareCardTarget}`}>
              <div className={styles.compareCardHead}>
                <span className={styles.compareCardName}>
                  {t('table.colNailfolio')}
                </span>
              </div>
              <dl className={styles.compareCardList}>
                {COMPARE_TABLE_ROWS.map(row => (
                  <div key={row.nailfolioKey} className={styles.compareRow}>
                    <dt>{t(row.labelKey)}</dt>
                    <dd>{t(row.nailfolioKey)}</dd>
                  </div>
                ))}
              </dl>
            </li>
            {/* ── Booking (Booksy / Fresha) ── */}
            <li className={styles.compareCard}>
              <div className={styles.compareCardHead}>
                <span className={styles.compareCardName}>
                  {t('table.colBooking')}
                </span>
              </div>
              <dl className={styles.compareCardList}>
                {COMPARE_TABLE_ROWS.map(row => (
                  <div key={row.bookingKey} className={styles.compareRow}>
                    <dt>{t(row.labelKey)}</dt>
                    <dd>{t(row.bookingKey)}</dd>
                  </div>
                ))}
              </dl>
            </li>
            {/* ── Social (IG / Pinterest) ── */}
            <li className={styles.compareCard}>
              <div className={styles.compareCardHead}>
                <span className={styles.compareCardName}>
                  {t('table.colSocial')}
                </span>
              </div>
              <dl className={styles.compareCardList}>
                {COMPARE_TABLE_ROWS.map(row => (
                  <div key={row.socialKey} className={styles.compareRow}>
                    <dt>{t(row.labelKey)}</dt>
                    <dd>{t(row.socialKey)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          </ul>

          <CompareTableFooterMolecule />
        </SectionComposition>

        {/* ─── 3-5. CONTRAST — Booksy / Instagram / Pinterest obok Nailfolio.
            Owner: reading text stands on white; paper is breathing
            space. Booking and Pinterest are white reading bands. Social stays
            on paper around its ink panel and illustration. The ink panel is
            this page's visual contrast; the white bands keep the running copy
            readable without adding a tinted wash. `constrained={false}` lets
            each content wrapper keep its existing width. ─── */}
        {COMPARE_CONTRAST_SECTIONS.map(entry => (
          <SectionComposition
            key={entry.id}
            tone={entry.id === 'social' ? 'plain' : 'white'}
            constrained={false}
            className={styles.contrastSection}>
            {entry.id === 'social' ? (
              <SocialStatementInkPanel />
            ) : (
              <div className={styles.contrastInner}>
                <SectionHeaderMolecule
                  className={clsx(
                    styles.sectionHeader,
                    styles.sectionHeaderScaled
                  )}
                  title={t(entry.headlineKey)}
                />
                <div className={styles.contrastBody}>
                  <p>{t(entry.body1Key)}</p>
                  <p>{t(entry.body2Key)}</p>
                </div>
                {entry.proofKey ? (
                  <p className={styles.contrastProof}>{t(entry.proofKey)}</p>
                ) : null}
              </div>
            )}
          </SectionComposition>
        ))}

        {/* ─── 6. FAQ — kanon: FaqSection molecule; band (breakout +
            kontener lp) = Section as='div' (FaqSection sam renderuje
            <section aria-labelledby>). Powierzchnia banda = papier, a szew
            z sekcją nad nim niesie para hairline'ów (border-block) — detale
            i uzasadnienie przy .faqSection w module. ─── */}
        <SectionComposition as='div' bordered className={styles.faqSection}>
          <FaqSectionMolecule
            title={t('faq.headline')}
            headingId='compare-faq-heading'
            idPrefix='compare-faq'
            items={COMPARE_FAQ.map(item => ({
              id: item.questionKey,
              question: t(item.questionKey),
              answer: t(item.answerKey),
            }))}
          />
        </SectionComposition>

        {/* ─── 7. FINAL CTA ─── */}
        <FinalCtaBandOrganism
          headlineLine1={t('finalCta.headline')}
          body={t('finalCta.body')}
          actions={
            <ButtonAtom
              direction='forward'
              variant='primary'
              size='lg'
              onClick={withSignupTracking('compare-final', goToSignup)}>
              {t('finalCta.cta')}
            </ButtonAtom>
          }
          secondary={
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.PRICING}
              onClick={() => trackCtaClick('compare-pricing-link')}>
              {t('finalCta.secondary')}
            </AppParagraphLinkAtom>
          }
          footnote={
            <CtaFootnoteWithPriceMolecule text={t('finalCta.reassurance')} />
          }
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking('compare-sticky', goToSignup)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
