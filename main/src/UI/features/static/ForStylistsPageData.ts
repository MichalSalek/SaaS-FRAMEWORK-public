import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';

const LP_LIMITS = PRICING_POLICY.LIMITS;

/* ─── Problem→Solution pairs ─── */
export interface ProblemEntry {
  n: string;
  problemKey: string;
  solutionKey: string;
}

export const PROBLEMS_DATA: ProblemEntry[] = [
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
];

/* ─── Benefits ─── */
export interface BenefitEntry {
  n: string;
  iconName: string;
  titleKey: string;
  bodyKey: string;
  detailKey?: string;
  highlight?: boolean;
}

/* DECISION (nie usuwaj tego komentarza):
 * Benefity przycięte 6→4 (digest conversion #160 + distinctiveness): zostają
 * TYLKO te UNIKALNE vs HOME — filtrowalna galeria (b01), QR przy stanowisku
 * (b03), 0% prowizji (b05, highlight) oraz analityka galerii (b07 — "siła
 * galerii mierzy, co działa", czego HOME nie ma). Usunięte b02 (historia
 * klientki) / b04 (sesja inspiracji) powielały HOME, a b06 (solo→salon)
 * duplikuje sąsiednią sekcję Playbook. Klucze b02/b04/b06 zostają osierocone
 * w common.json celowo (poza scope — nie ruszamy common.json). iconName są
 * tu zachowane jako dane, ale lista benefitów renderuje sam serif-numeral
 * jako marker (Aesop restraint — bez ikon-per-bullet).
 * S+ (2026-07-17): doszedł b08 (Wiadomości + telefon na profilu, funkcja
 * LIVE 2026-07-16) jako nowy benefit UNIKALNY vs HOME (messaging bije Booksy
 * na two-way chat), lista rośnie 4 do 5, highlight b05 przesunięty na n:'05'.
 * S81 (/ui 2026-07-18): b08 (Wiadomości) PODNIESIONE na n:'02' — copy r16
 * pozycjonuje komunikator jako FILAR (nie dodatek), a render trzymał go na
 * przedostatniej. Nowa waga: galeria=wejście (01) → rozmowa/ustalenia=filar
 * (02) → QR (03) → siła galerii (04) → 0% prowizji=highlight-domknięcie (05,
 * renderowany osobno jako gold-block, kolejność w tablicy bez znaczenia dla
 * jego pozycji — `find(highlight)`). Numerały NIE renderowane (Benefits =
 * parallel features), n = porządek listy w lewej kolumnie splitu. */
export const BENEFITS_DATA: BenefitEntry[] = [
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
];

export interface PlaybookEntry {
  n: string;
  iconName: string;
  titleKey: string;
  bodyKey: string;
  metaKey: string;
}

export const STYLIST_PLAYBOOK: PlaybookEntry[] = [
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
] as const;

/* ─── Pricing preview ─── */
/* Bez pola `n`/numeracji na kartach (S22): tiery to NIE sekwencja kroków
 * (Style Policy §6) — porządek niesie sam układ siatki. Tier kontaktowy
 * (Scale) renderuje się jako cichy pełnoszerokościowy wiersz POD siatką
 * (wzorzec .scaleCta z /pricing), nie jako 5. karta-sierota. */
/**
 * Cecha teasera. `count` (z PRICING_POLICY, SSOT) interpolowany do szablonu
 * `{count}` klucza lokalnego → liczba nie jest hardcodowana w copy (zero driftu
 * przy zmianie limitu). Namespace teasera jest scoped (bez `static.pricing`),
 * więc klucze zostają lokalne — szablon krótki, drift-safe.
 */
export interface PreviewFeature {
  key: string;
  count?: number;
}

export interface PricingPreviewTier {
  /* Kernel PricingPlan (NIE lowercase slug) — id musi zgadzać się 1:1
   * z `usePricingPlans().id`, inaczej lookup ceny nigdy nie trafia i
   * PriceSlot kręci skeleton w nieskończoność (lekcja AGENTS: lookup
   * po kernel PricingPlan, nie po lowercase tier.id). */
  id: PricingPlan;
  name: string;
  periodLabelKey?: string;
  featureKeys: PreviewFeature[];
  highlighted?: boolean;
  isContact?: boolean;
}

export const PRICING_PREVIEW: PricingPreviewTier[] = [
  {
    id: PricingPlanValue.FREE,
    name: 'Free',
    periodLabelKey: 'pricing.freePeriod',
    featureKeys: [
      {
        key: 'pricing.freeFeature1',
        count: LP_LIMITS.FREE.max_gallery_records,
      },
      { key: 'pricing.freeFeature2' },
      { key: 'pricing.freeFeature3' },
    ],
  },
  {
    id: PricingPlanValue.PRO,
    name: 'Pro',
    periodLabelKey: 'pricing.proPeriod',
    featureKeys: [
      { key: 'pricing.proFeature1' },
      { key: 'pricing.proFeature2', count: LP_LIMITS.PRO.max_pinned_records },
      { key: 'pricing.proFeature3' },
    ],
    highlighted: true,
  },
  {
    id: PricingPlanValue.PRO_PLUS,
    name: 'Pro Marka',
    periodLabelKey: 'pricing.proPlusPeriod',
    featureKeys: [
      { key: 'pricing.proPlusFeature1' },
      { key: 'pricing.proPlusFeature2' },
    ],
  },
  {
    id: PricingPlanValue.STUDIO,
    name: 'Studio',
    periodLabelKey: 'pricing.studioPeriod',
    featureKeys: [
      { key: 'pricing.studioFeature1' },
      { key: 'pricing.studioFeature2' },
      {
        key: 'pricing.studioFeature3',
        count: LP_LIMITS.STUDIO.max_pinned_records,
      },
    ],
  },
  {
    id: PricingPlanValue.SCALE,
    name: 'Scale',
    isContact: true,
    featureKeys: [
      { key: 'pricing.scaleFeature1' },
      { key: 'pricing.scaleFeature2' },
      { key: 'pricing.scaleFeature3' },
    ],
  },
];

/* ─── FAQ data ─── */
export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

/* DECISION (nie usuwaj tego komentarza):
 * Kolejnosc FAQ (FAQ-1): risk-reversal q04 podniesione na pozycje #2 — najczestsza
 * obiekcja deep-page supply tuz po q01. Reszta zachowuje pierwotny porzadek.
 * Ten sam array zasila FAQPage JSON-LD (buildForStylistsFaqJsonLd .map) — render
 * i schema sa z definicji spojne (jeden SoT, brak osobnej listy do synchronizacji). */
export const OBJECTION_FAQ: FaqItem[] = [
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
];
