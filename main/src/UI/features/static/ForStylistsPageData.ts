import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';

/* ─── Problem→Solution pairs ─── */
export interface ProblemEntry {
  n: string;
  problemKey: string;
  solutionKey: string;
}

export const PROBLEMS_DATA = [
  {
    n: '01',
    problemKey: 'problems.p01Problem',
    solutionKey: 'problems.p01Solution',
  },
  {
    n: '02',
    problemKey: 'problems.p02Problem',
    solutionKey: 'problems.p02Solution',
  },
  {
    n: '03',
    problemKey: 'problems.p03Problem',
    solutionKey: 'problems.p03Solution',
  },
] as const satisfies readonly ProblemEntry[];

/* ─── Benefits ─── */
export interface BenefitEntry {
  n: string;
  iconName: string;
  titleKey: string;
  bodyKey: string;
  detailKey?: string;
  highlight?: boolean;
}

/* DECISION: benefits list only what HOME does not show: filterable gallery (b01),
 * messaging (b08), QR at the station (b03), gallery analytics (b07) and 0% commission
 * (b05, the highlight, rendered separately via `find(highlight)`). b02/b04/b06 were cut
 * as duplicates of HOME and the Playbook; their locale keys are orphaned on purpose.
 * `n` is list order only: no numerals or icons render. */
const BENEFITS_ROWS = [
  {
    n: '01',
    iconName: 'Image',
    titleKey: 'benefitsSection.b01Title',
    bodyKey: 'benefitsSection.b01Body',
  },
  {
    n: '02',
    iconName: 'ChatCircleText',
    titleKey: 'benefitsSection.b08Title',
    bodyKey: 'benefitsSection.b08Body',
  },
  {
    n: '03',
    iconName: 'QrCode',
    titleKey: 'benefitsSection.b03Title',
    bodyKey: 'benefitsSection.b03Body',
  },
  {
    n: '04',
    iconName: 'ChartLineUp',
    titleKey: 'benefitsSection.b07Title',
    bodyKey: 'benefitsSection.b07Body',
  },
  {
    n: '05',
    iconName: 'CurrencyCircleDollar',
    titleKey: 'benefitsSection.b05Title',
    bodyKey: 'benefitsSection.b05Body',
    highlight: true,
  },
] as const satisfies readonly BenefitEntry[];
export const BENEFITS_DATA: readonly (BenefitEntry &
  (typeof BENEFITS_ROWS)[number])[] = BENEFITS_ROWS;

export interface PlaybookEntry {
  n: string;
  iconName: string;
  titleKey: string;
  bodyKey: string;
  metaKey: string;
}

export const STYLIST_PLAYBOOK = [
  {
    n: '01',
    iconName: 'Image',
    titleKey: 'playbook.p01Title',
    bodyKey: 'playbook.p01Body',
    metaKey: 'playbook.p01Meta',
  },
  {
    n: '02',
    iconName: 'QrCode',
    titleKey: 'playbook.p02Title',
    bodyKey: 'playbook.p02Body',
    metaKey: 'playbook.p02Meta',
  },
  {
    n: '03',
    iconName: 'ShareNetwork',
    titleKey: 'playbook.p03Title',
    bodyKey: 'playbook.p03Body',
    metaKey: 'playbook.p03Meta',
  },
  {
    n: '04',
    iconName: 'Notepad',
    titleKey: 'playbook.p04Title',
    bodyKey: 'playbook.p04Body',
    metaKey: 'playbook.p04Meta',
  },
] as const satisfies readonly PlaybookEntry[];

/* ─── Pricing preview ─── */
/* No `n` numbering on the cards: tiers are NOT a sequence of steps
 * (Style Policy §6), the grid layout carries the order. The contact tier
 * (Scale) renders as a quiet full-width row UNDER the grid (the .scaleCta
 * pattern from /pricing), not as a 5th orphan card. */
/**
 * Lines per preview card. The lines themselves are a projection of the plan
 * feature catalog (`planFeatureHighlights`, application/pricing): what the
 * plan adds over the next cheaper one first. No hand-kept bullets here.
 */
export const STYLIST_PREVIEW_FEATURE_COUNT = 3;

export interface PricingPreviewTier {
  id: PricingPlan;
  highlighted?: boolean;
  isContact?: boolean;
}

export const PRICING_PREVIEW: PricingPreviewTier[] = [
  { id: PricingPlanValue.FREE },
  { id: PricingPlanValue.PRO, highlighted: true },
  { id: PricingPlanValue.PRO_PLUS },
  { id: PricingPlanValue.STUDIO },
  { id: PricingPlanValue.SCALE, isContact: true },
];

/* ─── FAQ data ─── */
export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

/* DECISION: the risk-reversal q04 sits at position 2, right after q01, as the most
 * common objection. This array also feeds the FAQPage JSON-LD, so render and schema
 * cannot diverge. */
export const OBJECTION_FAQ = [
  { questionKey: 'faq.q01', answerKey: 'faq.a01' },
  { questionKey: 'faq.q04', answerKey: 'faq.a04' },
  { questionKey: 'faq.q03', answerKey: 'faq.a03' },
  { questionKey: 'faq.q02', answerKey: 'faq.a02' },
  { questionKey: 'faq.q05', answerKey: 'faq.a05' },
  { questionKey: 'faq.q06', answerKey: 'faq.a06' },
  { questionKey: 'faq.q07', answerKey: 'faq.a07' },
  { questionKey: 'faq.q08', answerKey: 'faq.a08' },
  { questionKey: 'faq.q09', answerKey: 'faq.a09' },
  { questionKey: 'faq.q10', answerKey: 'faq.a10' },
  { questionKey: 'faq.q11', answerKey: 'faq.a11' },
] as const satisfies readonly FaqItem[];
