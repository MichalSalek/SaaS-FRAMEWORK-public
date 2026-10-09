import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';

const SP_LIMITS = PRICING_POLICY.LIMITS;

/* ─── Benefits ───
 * Bez pól `n` (Style Policy §6): to RÓWNOLEGŁE feature'y, nie kroki —
 * numeracja 01-04 sugerowała fałszywą sekwencję. Kotwicę kafla niesie
 * kafelek ikony (jeden układ dla wszystkich wpisów). */
export interface BenefitEntry {
  iconName: string;
  titleKey: string;
  bodyKey: string;
}

export const BENEFITS: BenefitEntry[] = [
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
];

export const OPERATING_ITEMS = [
  {
    id: 'owner',
    iconName: 'ChartLine',
    titleKey: 'operating.ownerTitle',
    bodyKey: 'operating.ownerBody',
    metaKey: 'operating.ownerMeta',
  },
  {
    id: 'team',
    iconName: 'Users',
    titleKey: 'operating.teamTitle',
    bodyKey: 'operating.teamBody',
    metaKey: 'operating.teamMeta',
  },
  {
    id: 'client',
    iconName: 'PaperPlaneTilt',
    titleKey: 'operating.clientTitle',
    bodyKey: 'operating.clientBody',
    metaKey: 'operating.clientMeta',
  },
] as const;

/* ─── FAQ data ─── */
export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

export const FAQ: FaqItem[] = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
  { questionKey: 'faq.q7', answerKey: 'faq.a7' },
  { questionKey: 'faq.q8', answerKey: 'faq.a8' },
  { questionKey: 'faq.q9', answerKey: 'faq.a9' },
];

/* ─── Hero metric callouts (Stripe Atlas pattern) ─── */
export interface HeroMetric {
  figureKey: string;
  labelKey: string;
}

export const HERO_METRICS: HeroMetric[] = [
  {
    figureKey: 'heroMetrics.stat1Figure',
    labelKey: 'heroMetrics.stat1Label',
  },
  {
    figureKey: 'heroMetrics.stat2Figure',
    labelKey: 'heroMetrics.stat2Label',
  },
  {
    figureKey: 'heroMetrics.stat3Figure',
    labelKey: 'heroMetrics.stat3Label',
  },
];

/* ─── Use cases (storytelling: Solo → Studio → Network, Notion pattern) ─── */
export interface UseCaseEntry {
  id: string;
  iconName: string;
  tagKey: string;
  titleKey: string;
  bodyKey: string;
  detailKey: string;
  /* Cała karta = <Link> (głos ownera S22) — .useCaseDetail to wizualny
   * wiersz-CTA, klikalna jest pełna powierzchnia karty. */
  href: string;
  featured?: boolean;
}

export const USE_CASES: UseCaseEntry[] = [
  {
    id: 'solo',
    iconName: 'UserFocus',
    tagKey: 'useCases.case1Tag',
    titleKey: 'useCases.case1Title',
    bodyKey: 'useCases.case1Body',
    detailKey: 'useCases.case1Detail',
    href: ROUTES_FRONT.PRICING,
  },
  {
    id: 'studio',
    iconName: 'Buildings',
    tagKey: 'useCases.case2Tag',
    titleKey: 'useCases.case2Title',
    bodyKey: 'useCases.case2Body',
    detailKey: 'useCases.case2Detail',
    href: ROUTES_FRONT.PRICING,
    featured: true,
  },
  {
    id: 'network',
    iconName: 'TreeStructure',
    tagKey: 'useCases.case3Tag',
    titleKey: 'useCases.case3Title',
    bodyKey: 'useCases.case3Body',
    detailKey: 'useCases.case3Detail',
    href: ROUTES_FRONT.CONTACT,
  },
];

/* ─── Pricing tier preview (Vercel/Linear pattern) ───
 * Bez pól `n` (Style Policy §6): plany to równoległe opcje, nie kroki. */
/**
 * Cecha teasera. `count` (z PRICING_POLICY, SSOT) interpolowany do szablonu
 * `{count}` klucza lokalnego → liczba nie hardcodowana w copy (zero driftu).
 * Namespace teasera jest scoped (bez `static.pricing`), klucze zostają lokalne.
 */
export interface PreviewFeature {
  key: string;
  count?: number;
}

export interface PricingTierPreview {
  id: 'PRO_PLUS' | 'STUDIO' | 'SCALE';
  nameKey: string;
  periodKey?: string;
  badgeKey?: string;
  featureKeys: readonly PreviewFeature[];
  isContact?: boolean;
  highlighted?: boolean;
}

export const PRICING_TIER_PREVIEW: readonly PricingTierPreview[] = [
  {
    id: 'PRO_PLUS',
    nameKey: 'pricingPreview.tier1Name',
    periodKey: 'pricingPreview.tier1Period',
    featureKeys: [
      { key: 'pricingPreview.tier1Feature1' },
      { key: 'pricingPreview.tier1Feature3' },
      {
        key: 'pricingPreview.tier1Feature4',
        count: SP_LIMITS.PRO_PLUS.max_pinned_records,
      },
    ],
  },
  {
    id: 'STUDIO',
    nameKey: 'pricingPreview.tier2Name',
    periodKey: 'pricingPreview.tier2Period',
    badgeKey: 'pricingPreview.tier2Badge',
    featureKeys: [
      { key: 'pricingPreview.tier2Feature1' },
      { key: 'pricingPreview.tier2Feature2' },
      { key: 'pricingPreview.tier2Feature3' },
      {
        key: 'pricingPreview.tier2Feature5',
        count: SP_LIMITS.STUDIO.max_pinned_records,
      },
    ],
    highlighted: true,
  },
  {
    id: 'SCALE',
    nameKey: 'pricingPreview.tier3Name',
    featureKeys: [
      { key: 'pricingPreview.tier3Feature1' },
      { key: 'pricingPreview.tier3Feature2' },
      { key: 'pricingPreview.tier3Feature3' },
      { key: 'pricingPreview.tier3Feature4' },
    ],
    isContact: true,
  },
] as const;
