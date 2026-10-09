import { LP_ASSETS } from '../../assets/lpAssets';

/* ─── Static data for HomePage sections ─── */

export const STEPS = [
  {
    n: '01',
    titleKey: 'steps.step1Title',
    bodyKey: 'steps.step1Body',
  },
  {
    n: '02',
    titleKey: 'steps.step2Title',
    bodyKey: 'steps.step2Body',
  },
  {
    n: '03',
    titleKey: 'steps.step3Title',
    bodyKey: 'steps.step3Body',
  },
] as const;

/* Bento tiles for the benefits section. Numerals removed (owner: te rzeczy NIE
 * mają kolejności — motyw numeracji wypalony w projekcie). The ordinal is meant
 * to be replaced by a short eyebrow-style keyword-label (micro-category) once
 * the i18n keys land (see labelKey note below).
 *
 * `span`: 'long' (4 of 6 grid cols) | 'short' (2 cols). Rows alternate
 * long|short ↔ short|long so the mosaic reads with variable rhythm and never
 * leaves a full-width tile with empty space:
 *   row1 [galeria:long · historia:short]
 *   row2 [qr:short · sesja:long]
 *   row3 [prowizja-ink:long · zespół:short]
 *
 * `labelKey` → eyebrow-style keyword-label (pages.home.benefits.b{n}Label).
 *
 * `highlight` = deep-ink color-block (the one dark beat / contrast atut).
 * `wide` = renders the Session Share QR-flow visual (needs the long span). */
export const BENEFITS = [
  {
    n: 'b1',
    titleIcon: 'filter',
    titleKey: 'benefits.b1Title',
    bodyKey: 'benefits.b1Body',
    labelKey: 'benefits.b1Label',
    span: 'long' as const,
    wide: false,
    highlight: false,
  },
  {
    n: 'b2',
    titleIcon: 'notepad',
    titleKey: 'benefits.b2Title',
    bodyKey: 'benefits.b2Body',
    labelKey: 'benefits.b2Label',
    span: 'short' as const,
    wide: false,
    highlight: false,
  },
  {
    n: 'b3',
    titleIcon: 'qr',
    titleKey: 'benefits.b3Title',
    bodyKey: 'benefits.b3Body',
    labelKey: 'benefits.b3Label',
    span: 'short' as const,
    wide: false,
    highlight: false,
  },
  {
    n: 'b4',
    titleIcon: 'share',
    titleKey: 'benefits.b4Title',
    bodyKey: 'benefits.b4Body',
    labelKey: 'benefits.b4Label',
    span: 'long' as const,
    wide: true,
    highlight: false,
  },
  {
    n: 'b5',
    titleIcon: 'money',
    titleKey: 'benefits.b5Title',
    bodyKey: 'benefits.b5Body',
    labelKey: 'benefits.b5Label',
    span: 'long' as const,
    wide: false,
    highlight: true,
  },
  {
    /* S81 (/ui): swap najsłabszego kafla (b6 „Solo i salon", dublował
     * studiosStrip + antysprzedawał solo) na MESSAGING — domyka lukę
     * copy↔render: headline benefits obiecuje „rozmowa o wizycie", a żaden
     * kafel jej nie pokazywał. Temat solo→salon niesie studiosStrip niżej. */
    n: 'b6',
    titleIcon: 'chat',
    titleKey: 'benefits.b6Title',
    bodyKey: 'benefits.b6Body',
    labelKey: 'benefits.b6Label',
    span: 'short' as const,
    wide: false,
    highlight: false,
  },
] as const;

export const PAIN_POINTS = [
  { id: 'p1', titleKey: 'pain.pain1', icon: 'pinterest' as const },
  { id: 'p2', titleKey: 'pain.pain2', icon: 'algorithm' as const },
  { id: 'p3', titleKey: 'pain.pain3', icon: 'memory' as const },
] as const;

export const FAQ_ITEMS = [
  // f0 = pytanie definicyjne encji (sygnał dla AI overviews / LLM: "nailfolio"
  // bywa mylone z fizycznymi wzornikami) — celowo PIERWSZE na liście.
  { id: 'f0', questionKey: 'faq.q0', answerKey: 'faq.a0' },
  { id: 'f1', questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { id: 'f2', questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { id: 'f3', questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { id: 'f4', questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { id: 'f5', questionKey: 'faq.q5', answerKey: 'faq.a5' },
] as const;

export const FIT_ITEMS = [
  {
    id: 'instagram',
    icon: 'instagram' as const,
    titleKey: 'fit.instagramTitle',
    bodyKey: 'fit.instagramBody',
    proofKey: 'fit.instagramProof',
  },
  {
    id: 'phoneRoll',
    icon: 'phoneRoll' as const,
    titleKey: 'fit.phoneRollTitle',
    bodyKey: 'fit.phoneRollBody',
    proofKey: 'fit.phoneRollProof',
  },
  {
    id: 'booking',
    icon: 'booking' as const,
    titleKey: 'fit.bookingTitle',
    bodyKey: 'fit.bookingBody',
    proofKey: 'fit.bookingProof',
  },
  {
    id: 'nailfolio',
    icon: 'nailfolio' as const,
    titleKey: 'fit.nailfolioTitle',
    bodyKey: 'fit.nailfolioBody',
    proofKey: 'fit.nailfolioProof',
  },
] as const;

/* Hero mosaic tiles — solid color-blocking (flat fills, NO gradient — floor).
 * `img` (opcjonalny): realne foto paznokci (drop do main/public/img/lp/). Gdy
 * ustawione, kafel renderuje foto (cover) zamiast solid color-block — wstawienie
 * obrazu = swap danych, bez zmian w komponencie. Prompty: docs/DOMAIN/marketing. */
export type HeroTile = {
  id: string;
  size: 'lg' | 'md' | 'sm';
  tone: string;
  img?: string;
};

export const HERO_TILES: readonly HeroTile[] = [
  {
    id: 't1',
    size: 'lg',
    tone: 'a',
    img: LP_ASSETS.hero.heroNail16VelvetCatEye,
  },
  {
    id: 't2',
    size: 'sm',
    tone: 'b',
    img: LP_ASSETS.hero.heroNail17GlazedKnit,
  },
  {
    id: 't3',
    size: 'md',
    tone: 'c',
    img: LP_ASSETS.hero.heroNail18CherryBottle,
  },
  {
    id: 't4',
    size: 'sm',
    tone: 'd',
    img: LP_ASSETS.hero.heroNail19MoltenFrench,
  },
  {
    id: 't5',
    size: 'md',
    tone: 'e',
    img: LP_ASSETS.hero.heroNail20Application,
  },
];
