import { LP_ASSETS } from '../../assets/lpAssets';

/* ─── How it works — 3 steps ───
 * DECISION: QR_STEPS feeds ONLY the HowTo JSON-LD in pages/for-clients.tsx. Do not render
 * it again: a visual „3 steps” section duplicated the visit-moments journey. The i18n keys
 * `how.step*` live for JSON-LD; `how.footnote` is the visit-moments footnote. */
export interface StepEntry {
  n: string;
  titleKey: string;
  bodyKey: string;
  wide?: boolean;
}

export const QR_STEPS = [
  {
    n: '01',
    titleKey: 'how.step01Title',
    bodyKey: 'how.step01Body',
  },
  {
    n: '02',
    titleKey: 'how.step02Title',
    bodyKey: 'how.step02Body',
  },
  {
    n: '03',
    titleKey: 'how.step03Title',
    bodyKey: 'how.step03Body',
    wide: true,
  },
] as const satisfies readonly StepEntry[];

/* ─── Benefits ─── */
export interface BenefitEntry {
  n: string;
  titleKey: string;
  bodyKey: string;
  detailKey?: string;
  highlight?: boolean;
}

/* DECISION: array order is visual weight, not the `n` ids (benefits are parallel, rendered
 * without numerals). b06 (messages) sits second because the copy positions client-stylist
 * messaging as a pillar; highlighted b05 (inspiration session) stays LAST as the closing block. */
const BENEFITS_DATA = [
  {
    n: '01',
    titleKey: 'benefits.b01Title',
    bodyKey: 'benefits.b01Body',
    detailKey: 'benefits.b01Detail',
  },
  {
    n: '06',
    titleKey: 'benefits.b06Title',
    bodyKey: 'benefits.b06Body',
  },
  {
    n: '02',
    titleKey: 'benefits.b02Title',
    bodyKey: 'benefits.b02Body',
  },
  {
    n: '03',
    titleKey: 'benefits.b03Title',
    bodyKey: 'benefits.b03Body',
    detailKey: 'benefits.b03Detail',
  },
  {
    n: '04',
    titleKey: 'benefits.b04Title',
    bodyKey: 'benefits.b04Body',
  },
  {
    n: '05',
    titleKey: 'benefits.b05Title',
    bodyKey: 'benefits.b05Body',
    detailKey: 'benefits.b05Detail',
    highlight: true,
  },
] as const satisfies readonly BenefitEntry[];
export const BENEFITS: readonly (BenefitEntry &
  (typeof BENEFITS_DATA)[number])[] = BENEFITS_DATA;

export const VISIT_MOMENTS = [
  {
    id: 'salon',
    titleKey: 'visitMoments.m01Title',
    bodyKey: 'visitMoments.m01Body',
  },
  {
    id: 'choice',
    titleKey: 'visitMoments.m02Title',
    bodyKey: 'visitMoments.m02Body',
  },
  {
    id: 'share',
    titleKey: 'visitMoments.m03Title',
    bodyKey: 'visitMoments.m03Body',
  },
  {
    id: 'aftervisit',
    titleKey: 'visitMoments.m04Title',
    bodyKey: 'visitMoments.m04Body',
  },
] as const;

/* ─── Client FAQ ─── */
export interface ClientFaqItem {
  id: string;
  questionKey: string;
  answerKey: string;
}

export const CLIENT_FAQ = [
  { id: 'q01', questionKey: 'faq.q01Question', answerKey: 'faq.q01Answer' },
  { id: 'q02', questionKey: 'faq.q02Question', answerKey: 'faq.q02Answer' },
  { id: 'q03', questionKey: 'faq.q03Question', answerKey: 'faq.q03Answer' },
  { id: 'q04', questionKey: 'faq.q04Question', answerKey: 'faq.q04Answer' },
  { id: 'q05', questionKey: 'faq.q05Question', answerKey: 'faq.q05Answer' },
  { id: 'q06', questionKey: 'faq.q06Question', answerKey: 'faq.q06Answer' },
  { id: 'q07', questionKey: 'faq.q07Question', answerKey: 'faq.q07Answer' },
  { id: 'q08', questionKey: 'faq.q08Question', answerKey: 'faq.q08Answer' },
] as const satisfies readonly ClientFaqItem[];

/* ─── Discovery — real inspiration tiles (assets + i18n labels) ─── */
export const DISCOVERY_TILES = [
  { src: LP_ASSETS.portfolio.nailDiscover01, labelKey: 'discovery.tile1' },
  { src: LP_ASSETS.portfolio.nailDiscover02, labelKey: 'discovery.tile2' },
  { src: LP_ASSETS.portfolio.nailDiscover03, labelKey: 'discovery.tile3' },
  {
    src: LP_ASSETS.portfolio.manicure08,
    labelKey: 'discovery.tile4',
  },
] as const;

/* ─── Privacy mini-section items ─── */
export const PRIVACY_ITEMS = [
  { id: 'p01', textKey: 'privacy.item1' },
  { id: 'p02', textKey: 'privacy.item2' },
  { id: 'p03', textKey: 'privacy.item3' },
] as const;
