import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

/* Benefits.
 * No `n` fields (Style Policy §6): these are parallel features, not steps.
 * Numbering 01-04 implied a false sequence. The icon tile is the anchor,
 * one layout for every entry. */
export interface BenefitEntry {
  iconName: string;
  titleKey: string;
  bodyKey: string;
}

export const BENEFITS = [
  {
    iconName: 'Users',
    titleKey: 'benefits.b01Title',
    bodyKey: 'benefits.b01Body',
  },
  {
    iconName: 'UserCheck',
    titleKey: 'benefits.b02Title',
    bodyKey: 'benefits.b02Body',
  },
  {
    iconName: 'PaperPlaneTilt',
    titleKey: 'benefits.b03Title',
    bodyKey: 'benefits.b03Body',
  },
  {
    iconName: 'ChartLine',
    titleKey: 'benefits.b04Title',
    bodyKey: 'benefits.b04Body',
  },
] as const satisfies readonly BenefitEntry[];

export const OPERATING_ITEMS = [
  {
    id: 'owner',
    iconName: 'ChartLine',
    titleKey: 'operating.ownerTitle',
    bodyKey: 'operating.ownerBody',
  },
  {
    id: 'team',
    iconName: 'Users',
    titleKey: 'operating.teamTitle',
    bodyKey: 'operating.teamBody',
  },
  {
    id: 'client',
    iconName: 'PaperPlaneTilt',
    titleKey: 'operating.clientTitle',
    bodyKey: 'operating.clientBody',
  },
] as const;

/* ─── FAQ data ─── */
export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

export const FAQ = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
  { questionKey: 'faq.q7', answerKey: 'faq.a7' },
  { questionKey: 'faq.q8', answerKey: 'faq.a8' },
  { questionKey: 'faq.q9', answerKey: 'faq.a9' },
  { questionKey: 'faq.q10', answerKey: 'faq.a10' },
  { questionKey: 'faq.q11', answerKey: 'faq.a11' },
] as const satisfies readonly FaqItem[];

/* ─── Use cases (storytelling: Solo → Studio → Network, Notion pattern) ─── */
export interface UseCaseEntry {
  id: string;
  iconName: string;
  titleKey: string;
  bodyKey: string;
  detailKey: string;
  /* The whole card is a link (owner). .useCaseDetail is a visual CTA row.
   * The clickable surface is the full card. (owner) */
  href: string;
  featured?: boolean;
}

const USE_CASES_DATA = [
  {
    id: 'solo',
    iconName: 'UserFocus',
    titleKey: 'useCases.case1Title',
    bodyKey: 'useCases.case1Body',
    detailKey: 'useCases.case1Detail',
    href: ROUTES_FRONT.PRICING,
  },
  {
    id: 'studio',
    iconName: 'Buildings',
    titleKey: 'useCases.case2Title',
    bodyKey: 'useCases.case2Body',
    detailKey: 'useCases.case2Detail',
    href: ROUTES_FRONT.PRICING,
    featured: true,
  },
  {
    id: 'network',
    iconName: 'TreeStructure',
    titleKey: 'useCases.case3Title',
    bodyKey: 'useCases.case3Body',
    detailKey: 'useCases.case3Detail',
    href: ROUTES_FRONT.CONTACT,
  },
] as const satisfies readonly UseCaseEntry[];
export const USE_CASES: readonly (UseCaseEntry &
  (typeof USE_CASES_DATA)[number])[] = USE_CASES_DATA;

/* Pricing tier preview (Vercel/Linear pattern).
 * No `n` fields (Style Policy §6): plans are parallel options, not steps. */
/**
 * Lines per card: a projection of the plan feature catalog
 * (`planFeatureHighlights`, application/pricing), what the plan adds over the
 * next cheaper one first. No hand-kept bullets here.
 */
export const STUDIO_PREVIEW_FEATURE_COUNT = 4;

export interface PricingTierPreview {
  id: 'PRO_PLUS' | 'STUDIO' | 'SCALE';
  nameKey: string;
  badgeKey?: string;
  isContact?: boolean;
  highlighted?: boolean;
}

const PRICING_TIER_PREVIEW_DATA = [
  {
    id: 'PRO_PLUS',
    nameKey: 'pricingPreview.tier1Name',
  },
  {
    id: 'STUDIO',
    nameKey: 'pricingPreview.tier2Name',
    badgeKey: 'pricingPreview.tier2Badge',
    highlighted: true,
  },
  {
    id: 'SCALE',
    nameKey: 'pricingPreview.tier3Name',
    isContact: true,
  },
] as const satisfies readonly PricingTierPreview[];
export const PRICING_TIER_PREVIEW: readonly (PricingTierPreview &
  (typeof PRICING_TIER_PREVIEW_DATA)[number])[] = PRICING_TIER_PREVIEW_DATA;
