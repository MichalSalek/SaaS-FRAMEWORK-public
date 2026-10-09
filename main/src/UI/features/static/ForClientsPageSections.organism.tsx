import { SectionOrnamentMolecule } from '../../components/SectionOrnament/SectionOrnament.molecule';
import { ProcessIllustrationMolecule } from '../../assets/ProcessIllustration.molecule';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  CheckCircleIcon,
  CreditCardIcon,
  ArrowCounterClockwiseIcon,
  ShieldCheckIcon,
  ImagesIcon,
  EyeSlashIcon,
  type Icon,
} from '@phosphor-icons/react';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { TrustSignalsMolecule } from '../../components/TrustSignals/TrustSignals.molecule';
import { FaqSectionMolecule } from '../../components/FaqSection/FaqSection.molecule';
import { SectionComposition } from '../../components/Section/Section.composition';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { SectionHeaderMolecule } from '../../components/SectionHeader/SectionHeader.molecule';
import {
  BENEFITS,
  VISIT_MOMENTS,
  CLIENT_FAQ,
  PRIVACY_ITEMS,
  DISCOVERY_TILES,
} from './ForClientsPageData';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { LP_ASSETS } from '../../assets/lpAssets';
import styles from './ForClientsPage.module.css';

/* ─── 1b. DISCOVERY — real inspiration samples ─── */
export function ForClientsDiscoverySectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <SectionComposition
      className={styles.discoverySection}
      innerClassName={styles.discoveryInner}>
      <header className={styles.discoveryHeader}>
        <SectionOrnamentMolecule src={LP_ASSETS.decor.nailOutline}>
          <EyebrowAtom as='p' variant='plain'>
            {t('discovery.eyebrow')}
          </EyebrowAtom>
          <h2 className={styles.discoveryHeadline}>
            {t('discovery.headline')}
          </h2>
          <p className={styles.discoveryLede}>{t('discovery.lede')}</p>
        </SectionOrnamentMolecule>
      </header>
      <div className={styles.discoveryGrid} aria-hidden='true'>
        {DISCOVERY_TILES.map((tile, index) => (
          <figure
            key={tile.src}
            className={styles.discoveryTile}
            data-featured={index === 0 ? 'true' : undefined}>
            <Image
              quality={95}
              className={styles.discoveryTileImage}
              src={tile.src}
              alt=''
              fill
              sizes='(max-width: 767px) 50vw, 24vw'
            />
            <figcaption className={styles.discoveryTileLabel}>
              {t(tile.labelKey)}
            </figcaption>
          </figure>
        ))}
      </div>
    </SectionComposition>
  );
}

/* ─── 2. VISIT MOMENTS — the ONE numbered journey (QR → filtry → sesja).
 * The former "3 kroki" section duplicated this flow with ~90px+ numerals
 * (scale violation) — removed; its only unique fact (7-day session
 * availability) lives on as the footnote below (existing `how.footnote`). ─── */
export function ForClientsVisitMomentsSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <SectionComposition className={styles.visitMomentsSection} bordered>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        eyebrow={t('visitMoments.eyebrow')}
        eyebrowVariant='plain'
        title={t('visitMoments.headline')}>
        {t('visitMoments.lede')}
      </SectionHeaderMolecule>
      <ProcessIllustrationMolecule
        src={LP_ASSETS.process.clientBeforeVisit}
        alt={t('visitMoments.processAlt')}
        className={styles.processIllustration}
      />
      <div className={styles.visitMomentsLayout}>
        <div className={styles.visitMomentsGrid}>
          {VISIT_MOMENTS.map((moment, index) => (
            <article
              key={moment.id}
              className={styles.visitMoment}
              data-featured={index === 1 ? 'true' : undefined}>
              <div className={styles.visitMomentMetaRow}>
                <EyebrowAtom as='span' variant='plain'>
                  {t(moment.metaKey)}
                </EyebrowAtom>
                <span
                  className={styles.visitMomentNumeral}
                  data-num={String(index + 1).padStart(2, '0')}
                  aria-hidden='true'
                />
              </div>
              <div className={styles.visitMomentContent}>
                <h3 className={styles.visitMomentTitle}>
                  {t(moment.titleKey)}
                </h3>
                <p className={styles.visitMomentBody}>{t(moment.bodyKey)}</p>
              </div>
            </article>
          ))}
        </div>
        <figure className={styles.visitMomentPhoto}>
          <Image
            quality={95}
            className={styles.visitMomentPhotoImage}
            src={LP_ASSETS.editorial.staticClientPhoneCafe06}
            alt={t('visitMoments.photoAlt')}
            width={1024}
            height={1536}
            sizes='(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) 512px, 480px'
          />
        </figure>
      </div>
      <p className={styles.visitMomentsFootnote}>{t('how.footnote')}</p>
    </SectionComposition>
  );
}

/* ─── 3. BENEFITS — głos S24/1 = A (split 7/5): lista benefitów w lewej
 * kolumnie, duży sticky PhoneMockup w prawej (dowód obok obietnicy).
 * Forma 1:1 z playground S24Vote1ClientsBenefits (.v1aGrid/.v1aPhoneCol).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Benefit-itemy NIE migrują na FeatureCardMolecule/FeatureCardGridMolecule.
 * Układ to BORDERED LIST z wewnętrznymi separator-borderami (nie grid kart):
 *   • .benefitsList = kontener z hairline border + overflow:hidden (border-radius);
 *     kolejne .benefit wiersze = document-list (border-top per wiersz, no gap).
 *   • .benefit[data-highlight] = wiersz O5 jako solid-gold color-block —
 *     nie istnieje w FeatureCard API.
 *   • .benefitDetail = oddzielny boxed element (border + tint + italic) pod body —
 *     odpowiada co prawda FeatureCard `meta`, ale styl inline-box jest niestandardowy.
 *   • .benefitsGrid to split 7/5 z lewą kolumną listy + sticky PhoneMockup po prawej —
 *     FeatureCardGrid zastąpiłoby split-grid, łamiąc layout mechanikę.
 * Migracja DIVERGENT — hand-rolled zostaje dla pixel-parity. ─── */
export function ForClientsBenefitsSectionOrganism() {
  const t = useTranslations('static.forClients');
  const appScreen = useAppScreenshots();

  return (
    /* Band = Section. constrained={false}: dzieci same trzymają szerokości
       (header/grid z lp-override, footnote na gutter-edge — stan 1:1). */
    <SectionComposition
      bordered
      className={styles.benefitsSection}
      constrained={false}>
      <SectionHeaderMolecule
        className={clsx(styles.sectionHeader, styles.sectionHeaderScaled)}
        eyebrow={t('benefits.eyebrow')}
        eyebrowVariant='plain'
        title={t('benefits.headline')}>
        {t('benefits.lede')}
      </SectionHeaderMolecule>

      <div className={styles.benefitsGrid}>
        {/* Benefits are parallel features, NOT a sequence → no numerals
            (S20: numbering reserved for real sequences like visitMoments). */}
        <div className={styles.benefitsList}>
          {BENEFITS.map(b => (
            <article
              key={b.n}
              className={styles.benefit}
              data-highlight={b.highlight || undefined}
              data-scroll-reveal>
              <div className={styles.benefitContent}>
                <h3 className={styles.benefitTitle}>{t(b.titleKey)}</h3>
                <p className={styles.benefitText}>{t(b.bodyKey)}</p>
                {b.detailKey && (
                  <p className={styles.benefitDetail}>{t(b.detailKey)}</p>
                )}
              </div>
            </article>
          ))}
        </div>

        {/* PhoneMockup — real stylist-gallery screen ("po sparowaniu widzisz
            galerię swojej stylistki"); caption lives in aria only (kanon). */}
        <div className={styles.benefitsPhoneCol}>
          <PhoneMockupMolecule
            label={t('benefits.mockup1Label')}
            route='/stylist/ola-nails'
            size='lg'
            screenshot={appScreen('appPublicProfile')}
          />
        </div>
      </div>

      <p className={styles.benefitsFootnote}>{t('benefits.footnote')}</p>
    </SectionComposition>
  );
}

/* (3c. PORTFOLIO STRIP — głos S22/4 = B — żyje w osobnym pliku
 * ForClientsPortfolioStrip.tsx: eslint max-lines 300.) */

/* ─── 4. MID-FUNNEL CTA — closed ink rectangle (InkPanel, taste-14 kanon):
 * pull-quote left + CTA cluster right, same content as the former
 * full-bleed split band. ─── */
/* ─── 5. TRUST — od S24 przez kanoniczne TrustSignals variant='chips'
 * (obrzeżone pigułki weszły do molecule — luka „borderless-only" zamknięta;
 * per-page kopia .trustList usunięta). ─── */
const TRUST_ITEMS: ReadonlyArray<{ ChipIcon: Icon; textKey: string }> = [
  { ChipIcon: CheckCircleIcon, textKey: 'trust.item1' },
  { ChipIcon: CreditCardIcon, textKey: 'trust.item2' },
  { ChipIcon: ArrowCounterClockwiseIcon, textKey: 'trust.item3' },
  { ChipIcon: ShieldCheckIcon, textKey: 'trust.item4' },
  { ChipIcon: ImagesIcon, textKey: 'trust.item5' },
  { ChipIcon: EyeSlashIcon, textKey: 'trust.item6' },
];

export function ForClientsTrustSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    <section className={styles.trustSection}>
      <div className={styles.trustInner}>
        {/* Wrapper lewej kolumny OBOWIĄZKOWY (wzór .v2cLeft z playgroundu):
            bez niego 2-kolumnowy grid auto-placementem rozrzuca eyebrow/h2/
            lede/chips naprzemiennie między kolumny (h2 ląduje nad pillami). */}
        <div className={styles.trustLeft}>
          <EyebrowAtom as='p' variant='plain'>
            {t('trust.eyebrow')}
          </EyebrowAtom>
          {/* Głos S24/2 = C z akcentem A: „Bezpiecznie." w gold-italic
              (i18n <accent> tag, wzór .v2aDecl em z playgroundu). */}
          <h2 className={styles.trustHeadline}>
            {t.rich('trust.headline', {
              accent: chunks => (
                <em className={styles.trustHeadlineAccent}>{chunks}</em>
              ),
            })}
          </h2>
          <p className={styles.trustLede}>{t('trust.lede')}</p>
        </div>
        <TrustSignalsMolecule
          variant='chips'
          items={TRUST_ITEMS.map(({ ChipIcon, textKey }) => ({
            icon: <ChipIcon size={16} weight='regular' />,
            text: t(textKey),
          }))}
        />
      </div>
    </section>
  );
}

/* ─── 6. PRIVACY mini-section ───
 * Eyebrow lives OUTSIDE .privacyHead as a full-width grid row: on >=860px the
 * headline ("Twoje dane są Twoje.") and the list box share row 2, so the box's
 * top edge starts EXACTLY level with the headline — głos ownera S24 (naczelna
 * zasada layoutu: linie wyznaczają granice). Nie wciągać eyebrow z powrotem
 * do kolumny — to przywraca pionowy offset boxa. */
export function ForClientsPrivacySectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    /* Band = Section (bordered: para hairline 1:1); grid = innerClassName
       (max-width/centrowanie daje Section.constrained). */
    <SectionComposition
      bordered
      className={styles.privacy}
      innerClassName={styles.privacyInner}>
      <EyebrowAtom as='p' variant='plain' className={styles.privacyEyebrow}>
        {t('privacy.eyebrow')}
      </EyebrowAtom>
      <div className={styles.privacyHead}>
        <h2 className={styles.privacyHeadline}>{t('privacy.headline')}</h2>
        <p className={styles.privacyLede}>{t('privacy.lede')}</p>
      </div>
      <ul className={styles.privacyList}>
        {PRIVACY_ITEMS.map(item => (
          <li key={item.id}>{t(item.textKey)}</li>
        ))}
      </ul>
      <ProcessIllustrationMolecule
        src={LP_ASSETS.contextual.clients}
        alt={t('pageIllustrationAlt')}
        width={1536}
        height={1024}
        sizes='(max-width: 859px) calc(100vw - 32px), 768px'
        className={styles.privacyIllustration}
      />
    </SectionComposition>
  );
}

/* ─── 7. FAQ — canonical <FaqSection> molecule (skin lives in the
 * component; the page keeps only the full-bleed band + content width). ─── */
export function ForClientsFaqSectionOrganism() {
  const t = useTranslations('static.forClients');

  return (
    /* Band = Section (as='div': FaqSection sam renderuje <section>);
       inner constrained przejął rolę skasowanej .faqInner (lp+auto). */
    <SectionComposition as='div' className={styles.faqSection}>
      <FaqSectionMolecule
        eyebrow={t('faq.eyebrow')}
        title={t('faq.headline')}
        idPrefix='clients-faq'
        items={CLIENT_FAQ.map((item, idx) => ({
          id: item.id,
          question: t(item.questionKey),
          answer: t(item.answerKey),
          defaultOpen: idx === 0,
        }))}
      />
    </SectionComposition>
  );
}
