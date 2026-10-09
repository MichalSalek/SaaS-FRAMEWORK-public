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

/* ─── Social statement — głos S22/3 = C: statement + screen ZAMKNIĘTE razem
 * w ink-panelu (negatyw robi cezurę w rytmie strony, gold akcentuje słowo
 * kluczowe). Booking i pinterest zostają czystą typografią. ─── */
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
              eyebrow={t('social.eyebrow')}
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

  // Free-first (owner 2026-09-23, DOMAIN_SSOT §18): the signup CTA clears any
  // stale plan intent (useFreeSignupCta), so onboarding activates Free with no
  // plan step; the Pro trial is offered in the app at the moment of value.
  // DECISION (nie usuwaj tego komentarza):
  // Signup CTA = ACCOUNT-route → web-login funnel na KAŻDYM viewporcie, bez
  // /get-app bounce (parytet z pricingFunnelHref, S43 web-login-first). Wcześniej
  // bounce na /get-app zamykał lejek na desktopie PREVIEW/PROD.
  const goToSignup = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`
  );

  // Compare jest długą stroną konwersyjną (tabela + 3 kontrasty); jak wszystkie
  // siostrzane LP dostaje sticky bottom CTA, żeby decyzja „Nailfolio wygrywa"
  // miała przycisk pod ręką bez doscrollowania do final-CTA (mobile +15-25%).
  const showStickyCta = useShowOnScroll();

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO — kanon: LpHero molecule (gold-italic akcent) ─── */}
        {/* DECISION (nie usuwaj tego komentarza):
            Eyebrow text functions as the SEO <h1> — it carries the
            primary keyword phrase ("Porównanie narzędzi dla stylistki
            paznokci"). The question headline below it is the visual
            headline (h2). Pattern: SEO keyword in semantic h1, brand
            voice in h2 — same as HomePage hero (LpHero eyebrowAs='h1'). */}
        <LpHeroOrganism
          className={styles.compareHero}
          shimmerCta
          eyebrow={t('hero.eyebrow')}
          eyebrowAs='h1'
          headline={t('hero.headlineLine1')}
          headlineAccent={t('hero.headlineAccent')}
          lede={t('hero.lede')}
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

        {/* ─── 1b. PROOF — PhoneQuoteStrip (głos ownera S27/1 = B):
            pozycjonuje produkt względem narzędzi-do-rezerwacji jednym
            zdaniem nad tabelą. FORMA 1:1 z playgroundu; copy z i18n. ─── */}
        <SectionComposition>
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
            Social (głos S22/3 = C) = statement + screen w ink-panelu;
            booking/pinterest = czysta typografia jak dotąd.

            Motyw „Jeden krem" (S94/R4 + R2): WSZYSTKIE sekcje kontrastu stoją
            na papierze — zero alternacji po indeksie. Poprzednie
            `tone={i % 2 === 1 ? 'subtle' : 'plain'}` to była zebra na poziomie
            SEKCJI, tylko sterowana z TSX, więc strażnik `audit:tint-discipline`
            (skan CSS) jej nie widział; wychodził JEDEN krem wyłącznie
            przypadkiem — przy trzech wpisach danych. Czwarty wpis w
            COMPARE_CONTRAST_SECTIONS dokładał drugi kremowy pas bez żadnego
            sygnału w review. Kontrastem tej strony jest pełny negatyw
            ink-panelu w sekcji 'social' (R1), nie wash tła; rytm trzyma
            --section-block (~144px) plus rama hairline banda FAQ pod spodem.
            constrained={false}: szerokość lp trzymają istniejące wrappery
            (.contrastInner / .inkInner — różne per wariant treści). ─── */}
        {COMPARE_CONTRAST_SECTIONS.map(entry => (
          <SectionComposition
            key={entry.id}
            tone='plain'
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
                  eyebrow={t(entry.eyebrowKey)}
                  eyebrowVariant='plain'
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
            eyebrow={t('faq.eyebrow')}
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
