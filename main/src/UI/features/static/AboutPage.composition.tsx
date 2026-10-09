import { AppParagraphLinkAtom } from '../../components/AppParagraphLink/AppParagraphLink.atom';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  HeartIcon,
  EyeIcon,
  LightningIcon,
  ScissorsIcon,
  UsersThreeIcon,
  QuotesIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FeatureCardMolecule } from '../../components/FeatureCard/FeatureCard.molecule';
import { FeatureCardGridMolecule } from '../../components/FeatureCard/FeatureCardGrid.molecule';
import { FinalCtaBandOrganism } from '../../components/FinalCtaBand/FinalCtaBand.organism';
import { PhoneQuoteStripOrganism } from '../../components/PhoneQuoteStrip/PhoneQuoteStrip.organism';
import { SectionComposition } from '../../components/Section/Section.composition';
import { StatsBandMolecule } from '../../components/StatsBand/StatsBand.molecule';
import { StickyCtaBarMolecule } from '../../components/StickyCtaBar/StickyCtaBar.molecule';
import { TrustProseMolecule } from '../../components/TrustProse/TrustProse.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { LP_ASSETS } from '../../assets/lpAssets';
import { useShowOnScroll } from '../../hooks/useShowOnScroll';
import {
  AboutTimelineSectionOrganism,
  AboutFaqSectionOrganism,
  AboutHeroSectionOrganism,
} from './AboutPageSections.organism';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { useFreeSignupCta } from '../../shared/hooks/usePricingFunnelState';
import styles from './AboutPage.module.css';
import {
  trackCtaClick,
  withCtaTracking,
  withSignupTracking,
} from '../../../application/analytics/cta-events';

/* ─── Values config (icons only — text via i18n).
   Bez numeracji i bez karty-wide: wartości to NIE sekwencja (Style Policy §6),
   a równe karty w siatce = gust ownera (równość = jakość). ─── */
const VALUE_ITEMS: {
  icon: ReactNode;
  titleKey: string;
  bodyKey: string;
}[] = [
  {
    icon: <HeartIcon size={22} weight='regular' />,
    titleKey: 'values.v01Title',
    bodyKey: 'values.v01Body',
  },
  {
    icon: <EyeIcon size={22} weight='regular' />,
    titleKey: 'values.v02Title',
    bodyKey: 'values.v02Body',
  },
  {
    icon: <LightningIcon size={22} weight='regular' />,
    titleKey: 'values.v03Title',
    bodyKey: 'values.v03Body',
  },
];

export function AboutPageComposition() {
  const router = useRouter();
  const showStickyCta = useShowOnScroll();
  const t = useTranslations('static.about');
  const appScreen = useAppScreenshots();

  // DECISION (nie usuwaj tego komentarza):
  // Stylist CTA = ACCOUNT-route → web-login funnel na KAŻDYM viewporcie, bez
  // /get-app bounce (parytet z pricingFunnelHref, S43 web-login-first). Wcześniej
  // bounce na /get-app zamykał lejek na desktopie PREVIEW/PROD. Client CTA zostaje
  // na /get-app: produkt klientki jest z natury mobilny (skan QR w salonie).
  // Free-first (owner 2026-09-23): useFreeSignupCta czyści zalegający zamiar
  // planu z wcześniejszej wizyty w cenniku, inaczej ogólna rejestracja stąd
  // wpadała w onboardingu w krok płatności.
  const handleLoginNavigate = useFreeSignupCta(
    `${ROUTES_FRONT.USER_LOG}?intent=register&role=stylist`
  );

  const handleClientNavigate = () => {
    void router.push(ROUTES_FRONT.GET_APP);
  };

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        {/* ─── 1. HERO (wydzielone do AboutPageSections — max-lines) ─── */}
        <AboutHeroSectionOrganism />

        {/* ─── 2. MISSION — editorial pull-quote.
          Jedna konwencja etykiet sekcji na całej stronie: kicker (Eyebrow)
          + h2 — sectionMarker-dividery usunięte (dublowały etykiety 3×). ─── */}
        <SectionComposition className={styles.missionSection}>
          {/* S36 (głos ownera A): manifest jako zamknięta ink-karta (taste „negatyw
              = zamknięty prostokąt"), sekcja czysta — usunięty mdły half-tint +
              tint-box (taste „albo czysto albo pełny negatyw"). */}
          <div className={styles.missionContent}>
            <div className={styles.missionCard}>
              <EyebrowAtom
                as='p'
                variant='plain'
                className={styles.missionCardEyebrow}>
                {t('mission.eyebrow')}
              </EyebrowAtom>
              <p className={styles.missionPullQuote}>
                {t('mission.pullQuote')}
              </p>
            </div>
            <p className={styles.missionText}>{t('mission.text')}</p>
          </div>
        </SectionComposition>

        {/* ─── STATS — citable facts inline, dead-i18n activation ─── */}
        <SectionComposition
          bordered
          className={styles.statsSection}
          innerClassName={styles.statsInner}
          aria-labelledby='about-stats-heading'>
          <SectionHeaderMolecule
            className={styles.statsHeader}
            eyebrow={t('stats.eyebrow')}
            title={t('stats.headline')}
            titleId='about-stats-heading'
          />
          {/* Kanon plain-row (StatsBand) — ta strona była źródłem wzorca. */}
          <StatsBandMolecule
            variant='plain-row'
            items={[
              { figure: t('stats.stat1Figure'), label: t('stats.stat1Label') },
              { figure: t('stats.stat2Figure'), label: t('stats.stat2Label') },
              { figure: t('stats.stat3Figure'), label: t('stats.stat3Label') },
            ]}
          />
          <p className={styles.statsNote}>{t('stats.note')}</p>
        </SectionComposition>

        {/* ─── 3. STORY — editorial paragraphs with dropcap + bank-foto
          (dłonie klientki i stylistki) w zamkniętej ramie z radiusem,
          wypełnia prawą połowę siatki na desktopie. ─── */}
        <SectionComposition className={styles.storySection}>
          <SectionHeaderMolecule
            className={styles.accentHeader}
            eyebrow={t('story.eyebrow')}
            title={t('story.headline')}
          />

          <div className={styles.storyLayout}>
            <div className={styles.storyParagraphs}>
              <p className={`${styles.storyText} ${styles.storyTextLead}`}>
                {t('story.p1')}
              </p>
              <blockquote className={styles.storyQuote}>
                <QuotesIcon
                  size={20}
                  weight='fill'
                  className={styles.storyQuoteIcon}
                  aria-hidden='true'
                />
                {t('story.quote')}
              </blockquote>
              <p className={styles.storyText}>{t('story.p2')}</p>
              <p className={styles.storyText}>{t('story.p3')}</p>
            </div>
            <div className={styles.storyImage}>
              <Image
                src={LP_ASSETS.cta.beautyDiv04HandsJewelry}
                alt={t('story.photoAlt')}
                fill
                style={{ objectFit: 'cover' }}
                sizes='(max-width: 1023px) 100vw, 40vw'
              />
            </div>
          </div>
        </SectionComposition>

        {/* ─── 4. VALUES — równe karty wartości (bez numeracji) ─── */}
        <SectionComposition tone='subtle' className={styles.valuesSection}>
          <SectionHeaderMolecule
            className={styles.accentHeader}
            eyebrow={t('values.eyebrow')}
            title={t('values.headline')}>
            {t('values.lede')}
          </SectionHeaderMolecule>

          <FeatureCardGridMolecule columns={3} className={styles.valuesList}>
            {VALUE_ITEMS.map(v => (
              <FeatureCardMolecule
                key={v.titleKey}
                icon={v.icon}
                title={t(v.titleKey)}
                body={t(v.bodyKey)}
              />
            ))}
          </FeatureCardGridMolecule>
        </SectionComposition>

        {/* ─── 5. TIMELINE — zamknięta ink-karta (InkPanel) ─── */}
        <AboutTimelineSectionOrganism />

        {/* ─── 5b. PROOF — PhoneQuoteStrip (głos ownera S27/1 = C): ludzki
          finał historii, produkt jako jej puenta. FORMA 1:1 z playgroundu;
          copy z i18n, screen widoku klientki z LP_ASSETS. ─── */}
        <SectionComposition>
          <PhoneQuoteStripOrganism
            phone={{
              label: t('phoneQuote.phoneLabel'),
              route: ROUTES_FRONT.APP,
              screenshot: appScreen('appClientHome'),
            }}
            quoteTitle={t.rich('phoneQuote.title', {
              em: chunks => <em>{chunks}</em>,
            })}
            quoteBody={t('phoneQuote.body')}
          />
        </SectionComposition>

        {/* ─── 7. TRUST — proza zaufania (głos ownera /ui S52 = wariant C):
          ikona+bullet chips zastąpione jednym editorial zdaniem w roli --font-heading
          z gold-italic akcentami (kanon TrustProse). ─── */}
        <SectionComposition
          className={styles.trustSection}
          innerClassName={styles.trustInner}>
          <EyebrowAtom as='p' variant='plain'>
            {t('trust.eyebrow')}
          </EyebrowAtom>
          <TrustProseMolecule
            sentence={t.rich('trust.trustProse', {
              em: chunks => <em>{chunks}</em>,
            })}
          />
        </SectionComposition>

        {/* ─── 7b. FAQ — accordion (pary q1-q5 zasilają też FAQPage JSON-LD) ─── */}
        <AboutFaqSectionOrganism />

        {/* ─── 8. FINAL CTA — split path: Stylistka / Klientka; ink (F3) ─── */}
        <FinalCtaBandOrganism
          tone='ink'
          eyebrow={t('finalCta.splitEyebrow')}
          headlineLine1={t('finalCta.headlineLine1')}
          headlineAccent={t('finalCta.headlineAccent')}
          body={t('finalCta.body')}
          actions={
            <>
              <ButtonAtom
                variant='primary'
                size='lg'
                onClick={withSignupTracking(
                  'about-login',
                  handleLoginNavigate
                )}>
                <ScissorsIcon size={18} weight='regular' />
                {t('finalCta.ctaStylist')}
              </ButtonAtom>
              {/* Split-path ghost button — page-specific klasa zostaje
                (specificity bump w module strony wygrywa z kanonem
                .actions button molecule'a). */}
              <ButtonAtom
                variant='outlined'
                size='lg'
                className={styles.finalCtaButtonAlt}
                onClick={withCtaTracking('about-client', handleClientNavigate)}>
                <UsersThreeIcon size={18} weight='regular' />
                {t('finalCta.ctaClient')}
              </ButtonAtom>
            </>
          }
          secondary={
            <AppParagraphLinkAtom
              href={ROUTES_FRONT.PRICING}
              onClick={() => trackCtaClick('about-pricing-link')}>
              {t('finalCta.secondary')}
            </AppParagraphLinkAtom>
          }
          footnote={t('finalCta.reassurance')}
        />

        <StickyCtaBarMolecule
          visible={showStickyCta}
          text={t('stickyCta.text')}
          buttonText={t('stickyCta.button')}
          onButtonClick={withSignupTracking(
            'about-sticky',
            handleLoginNavigate
          )}
        />
      </div>
    </PublicLayoutComposition>
  );
}
