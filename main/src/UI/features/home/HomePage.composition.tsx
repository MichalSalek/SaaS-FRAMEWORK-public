import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { QrCodeIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { HomeShowcaseOrganism } from './HomeShowcase.organism';
import { HomeMidCtaOrganism } from './HomeMidCta.organism';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { SectionComposition } from '../../components/Section/Section.composition';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import { useNativeEntryRedirectGuard } from '../../layouts/guards/useNativeEntryRedirectGuard';
import { BenefitVisualAtom, HeroProofListAtom } from './HomePageVisuals.atom';
import { STEPS, BENEFITS, HERO_TILES, PAIN_POINTS } from './homePageData';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { HomePageBottomOrganism } from './HomePageBottom.organism';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import styles from './HomePage.module.css';
import { withSignupTracking } from '../../../application/analytics/cta-events';
import { EntryPriceNoteMolecule } from '../shared/pricing/EntryPriceNote.molecule';

export function HomePageComposition() {
  const t = useTranslations('pages.home');
  const appScreen = useAppScreenshots();
  const showStickyCta = useShowOnScroll();

  // Native wrapper (Capacitor): wejście na LP `/` → od razu /app (apka = produkt;
  // wylogowany native i tak bounce /app → login). Web/SSR nietknięte.
  useNativeEntryRedirectGuard();

  // Free-first (owner 2026-09-23, DOMAIN_SSOT §18): the signup CTA clears any
  // stale plan intent (useFreeSignupCta), so onboarding activates Free with no
  // plan step; the Pro trial is offered in the app at the moment of value.
  // DECISION (nie usuwaj tego komentarza):
  // Signup CTA = ACCOUNT-route (register → onboarding), więc wchodzi wprost
  // w web-login funnel na KAŻDYM viewporcie (desktop włącznie), bez /get-app
  // bounce (ten dotyczy PRODUCT-route, dla rejestracji zamykał lejek na
  // desktopie). Parytet z pricingFunnelHref (S43, web-login-first). Po
  // onboardingu desktop ląduje na /app/home (resolveDesktopBounceDecision),
  // mobile/app na core /app.
  const goToLogin = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register`
  );

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO ─── */}
        <section className={styles.hero} aria-label={t('hero.ariaLabel')}>
          <div className={styles.heroInner}>
            <div className={styles.heroText}>
              {/* DECISION (nie usuwaj tego komentarza):
                Eyebrow text functions as the SEO <h1> — it carries the
                primary keyword phrase ("Portfolio paznokci online dla
                stylistek" / "Online nail portfolio for nail artists").
                The emotional slogan below it is the visual headline (h2).
                Pattern: SEO keyword in semantic h1, brand voice in h2.
                Rendered via <Eyebrow as='h1' variant='chip'> so the SEO h1
                IS the eyebrow chip — element stays <h1>, style is the pill. */}
              <EyebrowAtom as='h1' variant='chip'>
                {t('hero.eyebrow')}
              </EyebrowAtom>
              <h2 className={styles.heroHeadline}>
                {t('hero.headlineLine1')}
                <br />
                <span className={styles.heroHeadlineAccent}>
                  {t('hero.headlineAccent')}
                </span>
              </h2>
              <p className={styles.heroLede}>{t('hero.lede')}</p>
              {/* data-cta-shimmer='on': powolny sweep na primary CTA (global.css) */}
              <div className={styles.heroActions} data-cta-shimmer='on'>
                <ButtonAtom
                  direction='forward'
                  variant='primary'
                  size='lg'
                  onClick={withSignupTracking('home-hero', goToLogin)}>
                  {t('hero.ctaPrimary')}
                </ButtonAtom>
              </div>
              {/* Próg wejścia wprost pod CTA — kwota z żywego cennika.
                  Strona główna nie podawała ceny NIGDZIE, więc każdy, kto
                  pytał „ile to kosztuje", musiał najpierw znaleźć cennik. */}
              {/* Everything after the CTA: on phones the two hero photos slot in
                  between the CTA and this group (owner vote S124, variant C). */}
              <div className={styles.heroAfterCta}>
                <EntryPriceNoteMolecule />
                <HeroProofListAtom />
                <AppParagraphLinkAtom
                  href={ROUTES_FRONT.FOR_CLIENTS}
                  className={styles.heroClientLink}>
                  {t('hero.ctaForClients')}
                </AppParagraphLinkAtom>
              </div>
            </div>

            {/* Mobile: destacked 2-up photos only. Tablet+: mosaic+phone+QR
             * overlap is voted LP canon — CSS restores it from 768 up. */}
            <div className={styles.heroComposition}>
              <div className={styles.heroMosaic} aria-hidden='true'>
                {HERO_TILES.map((tile, idx) => (
                  <div
                    key={tile.id}
                    className={styles.heroTile}
                    data-size={tile.size}
                    data-tone={tile.tone}
                    data-photo={tile.img ? 'true' : undefined}
                    data-rotate={idx === 2 ? 'true' : undefined}>
                    {tile.img && (
                      <Image
                        className={styles.heroTileImg}
                        src={tile.img}
                        alt=''
                        fill
                        sizes='(max-width: 767px) 50vw, (max-width: 1023px) 55vw, 480px'
                        quality={95}
                        // Perf: BEZ priority. Na mobile dwa kafle stoją tuż pod CTA
                        // (głos S124, wariant C), przy dolnej krawędzi folda, jako małe
                        // poziome kadry 4:3 — nie są elementem LCP (mobilny LCP to tekst
                        // nagłówka), a priority emitowałby <link rel=preload as=image>
                        // w <head> i kradł pasmo krytycznemu CSS/fontom. Kafle są
                        // dekoracyjne (alt='', aria-hidden mozaika, 25vw na desktopie =
                        // nie element LCP); blur placeholder pokrywa brak preloadu, a
                        // lazy-load w viewporcie i tak dociąga je od razu po layoucie.
                        placeholder='blur'
                        blurDataURL='data:image/webp;base64,UklGRlYAAABXRUJQVlA4IEoAAADQAQCdASoIAAgAAkA4JZQCdAEO/g3sAAD++yVf/o7f/xT/+Uf/6h//8Cv/9J//7J//xf//qAA='
                        style={{ objectFit: 'cover' }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className={styles.heroPhoneMockup}>
                <PhoneMockupMolecule
                  label={t('benefits.mockup1Label')}
                  route={ROUTES_FRONT.GALLERY}
                  state={t('benefits.mockup1State')}
                  size='lg'
                  screenshot={appScreen('appGalleryFeed')}
                />
              </div>
              {/* QR badge — desktop only; CSS hides it under 768. */}
              <div className={styles.heroQrBadge} aria-hidden='true'>
                <div className={styles.heroQrBadgeIcon}>
                  <QrCodeIcon size={28} weight='regular' />
                </div>
                <div className={styles.heroQrBadgeText}>
                  <span className={styles.heroQrBadgeLabel}>
                    {t('hero.qrBadgeLabel')}
                  </span>
                  <span className={styles.heroQrBadgeMeta}>
                    {t('benefits.mockup4State')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 2. PAIN — emotional hook ─── */}
        <SectionComposition
          className={styles.painSection}
          innerClassName={styles.painInner}
          aria-label={t('pain.ariaLabel')}>
          {/* GŁOS S20 (wariant A): ink-band — gold akcent na ostatnich dwóch
            słowach headline'u, problemy jako równe wiersze (bez numeracji,
            to nie sekwencja), złota puenta. */}
          <h2 className={styles.painStatement}>
            {t('pain.headline').split(' ').slice(0, -2).join(' ')}{' '}
            <span className={styles.painStatementAccent}>
              {t('pain.headline').split(' ').slice(-2).join(' ')}
            </span>
          </h2>
          <p className={styles.painBody}>{t('pain.body')}</p>
          <ul className={styles.painList}>
            {PAIN_POINTS.map(point => (
              <li key={point.id} className={styles.painItem}>
                <span className={styles.painMarker} aria-hidden='true' />
                <span>{t(point.titleKey)}</span>
              </li>
            ))}
          </ul>
          <p className={styles.painResolution}>{t('pain.resolution')}</p>
        </SectionComposition>
        {/* ─── 2. JAK TO DZIAŁA — głos 1C: split 7/5, pionowa lista kroków
          z numeral-markerami + realny screenshot w PhoneMockup ─── */}
        <SectionComposition
          tone='subtle'
          className={styles.howSection}
          aria-labelledby='how-heading'>
          <SectionHeaderMolecule
            className={styles.sectionHeader}
            eyebrow={t('howItWorks.eyebrow')}
            title={t('howItWorks.headline')}
            titleId='how-heading'>
            {t('howItWorks.lede')}
          </SectionHeaderMolecule>
          <div className={styles.stepsSplit}>
            <ol
              className={styles.steps}
              aria-label={t('howItWorks.stepsAriaLabel')}>
              {STEPS.map(step => (
                <li key={step.n} className={styles.stepItem}>
                  <span className={styles.stepNumeral} aria-hidden='true'>
                    {step.n}
                  </span>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>{t(step.titleKey)}</h3>
                    <p className={styles.stepText}>{t(step.bodyKey)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className={styles.stepsPhoneCol}>
              <PhoneMockupMolecule
                label={t('steps.step1Title')}
                route={ROUTES_FRONT.GALLERY_UPLOAD_ASSET}
                size='lg'
                screenshot={appScreen('appUpload')}
              />
            </div>
          </div>
          <ProcessIllustrationMolecule
            src={LP_ASSETS.process.stylistPortfolio}
            alt={t('howItWorks.processAlt')}
            className={styles.processIllustration}
          />
        </SectionComposition>
        {/* ─── Mid-CTA po „jak to działa" (S81 co drugą sekcję) ─── */}
        <HomeMidCtaOrganism
          headline={t('midCta.stepsHeadline')}
          accent={t('midCta.stepsAccent')}
          reassurance={t('midCta.stepsReassurance')}
          cta={t('midCta.stepsCta')}
          onAction={withSignupTracking('home-mid', goToLogin)}
        />

        {/* ─── 3. KORZYŚCI ─── */}
        {/* constrained=false: dzieci (header / bento / triptych / footnote)
          niosą własne max-width + centrowanie — band zostaje edge-to-edge. */}
        <SectionComposition
          className={styles.benefitsSection}
          constrained={false}
          aria-labelledby='benefits-heading'>
          <SectionHeaderMolecule
            className={styles.sectionHeader}
            eyebrow={t('benefits.eyebrow')}
            title={t('benefits.headline')}
            titleId='benefits-heading'>
            {t('benefits.lede')}
          </SectionHeaderMolecule>
          <div className={styles.benefitsList}>
            {BENEFITS.map(b => (
              <article
                key={b.n}
                className={styles.benefit}
                data-span={b.span}
                data-highlight={b.highlight || undefined}
                data-wide={b.wide || undefined}>
                {/* Numeral removed (owner: te kafle nie mają kolejności) —
                  micro-kategorię niesie eyebrow-style keyword-label. */}
                <EyebrowAtom as='span' variant='chip'>
                  {t(b.labelKey)}
                </EyebrowAtom>
                <div className={styles.benefitContent}>
                  <h3 className={styles.benefitTitle}>{t(b.titleKey)}</h3>
                  <p className={styles.benefitText}>{t(b.bodyKey)}</p>
                  {b.highlight && (
                    <div
                      className={styles.benefitHighlightAnchor}
                      aria-hidden='true'>
                      <span className={styles.benefitHighlightFigure}>0%</span>
                      <span className={styles.benefitHighlightLabel}>
                        {t('benefits.commissionLabel')}
                      </span>
                    </div>
                  )}
                  <BenefitVisualAtom kind={b.n} />
                </div>
              </article>
            ))}
          </div>
        </SectionComposition>

        <HomeShowcaseOrganism />

        {/* ─── Mid-CTA po showcase apki (S81 co drugą sekcję) ─── */}
        <HomeMidCtaOrganism
          headline={t('midCta.showcaseHeadline')}
          accent={t('midCta.showcaseAccent')}
          cta={t('midCta.showcaseCta')}
          onAction={withSignupTracking('home-showcase', goToLogin)}
        />

        {/* ─── Sections 4-7: Trust, Testimonials, ClientStrip, FinalCta ─── */}
        {/* (Mobile cezura „0%" usunięta — trzecie „0%" z rzędu na mobile:
          bento-karta 0% → cezura → trust-band 0% = monotonna sekwencja;
          rytm niosą teraz bento i trust, bez duplikatu.) */}
        <HomePageBottomOrganism
          onLoginClick={withSignupTracking('home-bottom', goToLogin)}
        />

        {/* ─── StickyCtaBar — per-page, scroll-triggered ─── */}
        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking('home-sticky', goToLogin)}
        />
      </div>
    </PublicLayoutComposition>
  );
}
