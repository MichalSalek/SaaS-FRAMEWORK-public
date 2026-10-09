import type { PricingPlan } from '../domain/pricing/pricing.config';
import { PricingPlanValue } from '../domain/pricing/pricing.config';

import { isPricingPlanNarrower } from '../models/type_narrowing';

/**
 * PLATFORM LIMITS
 *
 * Limity platformowe niezależne od planu cenowego.
 * Dotyczą kont KLIENTEK (nie stylistek).
 *
 * Klientki nie mają planu cenowego — korzystają z platformy za darmo.
 * Ich limity są stałymi platformowymi, nie per-plan.
 */
export const PLATFORM_LIMITS: { readonly MAX_PAIRED_STYLISTS: number } = {
  MAX_PAIRED_STYLISTS: 3,
};

/**
 * WARTOWNICZKA „BEZ LIMITU"
 *
 * DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
 * `-1` w kolumnie limitu znaczy „bez ograniczeń", a nie „zero" ani „brak danych".
 * Ta umowa była powtórzona jako gołe `=== -1`: PIĘĆ razy w tej polityce, siedem razy
 * na froncie (galeria, personel salonu, menedżer pinów, cennik, dialog obniżenia planu,
 * kafle zużycia, kreator zdjęcia) i — co wyszło dopiero w przeglądzie — SZEŚĆ razy
 * w BRAMKACH EGZEKUCJI po stronie backendu: `gallery-create`, `gallery-pin`,
 * `salon-staff-management` (×3) i `session-container-share`. Pierwsze podejście
 * migrowało tylko warstwę wyświetlania, czyli zostawiało nietknięte dokładnie te
 * miejsca, które naprawdę odmawiają wgrania, przypięcia, miejsca w zespole i
 * udostępnienia — a przywoływany niżej sufit galerii ściętej do piątki był błędem
 * właśnie w tej warstwie. Dziś predykat jest w obu.
 * Gołe porównanie z magiczną liczbą jest tu groźne
 * z jednego konkretnego powodu: każdy taki punkt to miejsce, gdzie POMINIĘCIE
 * sprawdzenia zamienia „bez limitu" w „limit równy minus jeden", czyli w blokadę
 * przy zerowej liczbie rekordów — i to blokadę dotykającą wyłącznie najdroższych
 * planów, czyli tych, które najrzadziej testujemy. Dokładnie tej klasy był sufit
 * publicznej galerii ścięty do piątki.
 *
 * Nazwana stała + predykat dają jedno miejsce do wyszukania (`isUnlimitedLimit`)
 * i jedno miejsce do zmiany, gdyby umowa kiedyś przeszła na `null`.
 */
export const UNLIMITED_LIMIT = -1;

/** `true`, gdy limit oznacza „bez ograniczeń". Patrz DECISION przy `UNLIMITED_LIMIT`. */
export const isUnlimitedLimit = (limit: number): boolean =>
  limit === UNLIMITED_LIMIT;

/**
 * PRICING LIMITS SSOT
 *
 * Single Source of Truth dla limitów planów cenowych STYLISTEK.
 *
 * ŹRÓDŁO: docs/DOMAIN/DOMAIN_SSOT.md
 * Data: 2026-02-08
 *
 * 5 TIERÓW:
 * - FREE → Free (demo)
 * - PRO → Pro (solo stylistka)
 * - PRO_PLUS → Pro+ (środkowy tier, wymagająca solo)
 * - STUDIO → Studio (salon z zespołem)
 * - SCALE → Scale/Custom/Enterprise (duże salony)
 *
 * Billing interval (monthly vs annual) zarządzany przez Stripe.
 */
export const PRICING_LIMITS_SSOT = {
  FREE: {
    max_gallery_records: 5, // Demo plan - celowo niskie limity
    max_pinned_records: 3, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: 2, // Demo plan - celowo niskie limity
    max_shares_per_hour: 5, // Tiered rate limit
    can_use_session_share: true, // Wszystkie plany
    can_use_multi_session: true, // Wszystkie plany (logowanie z wielu urządzeń)
    can_use_staff_accounts: false, // Tylko Studio+
    can_view_history: false,
    can_brand_profile: false,
    history_retention_days: 0,
    max_staff_members: 0,
  },
  PRO: {
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 10, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    max_shares_per_hour: 20, // Tiered rate limit
    can_use_session_share: true, // Wszystkie plany
    can_use_multi_session: true, // Wszystkie plany
    can_use_staff_accounts: false, // Tylko Studio+
    can_view_history: true,
    can_brand_profile: false,
    history_retention_days: 90,
    max_staff_members: 0,
  },
  PRO_PLUS: {
    // DECISION (nie usuwaj): środkowy tier solo — pełna historia klientek i branding profilu.
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 15, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    max_shares_per_hour: 20, // Tiered rate limit (jak PRO)
    can_use_session_share: true, // Wszystkie plany
    can_use_multi_session: true, // Wszystkie plany
    can_use_staff_accounts: false, // Zespół = Studio+
    can_view_history: true,
    can_brand_profile: true,
    history_retention_days: -1, // Pełna historia
    max_staff_members: 0,
  },
  STUDIO: {
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 30, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    max_shares_per_hour: -1, // Unlimited
    can_use_session_share: true, // Wszystkie plany
    can_use_multi_session: true, // Wszystkie plany
    can_use_staff_accounts: true, // Staff Accounts
    can_view_history: true,
    can_brand_profile: true,
    history_retention_days: -1,
    // DECISION (nie usuwaj tego komentarza): wszystkie konta zespolu sa w cenie planu (flat).
    // max_staff_members=9 = wlascicielka + 9 (fair-use cap 10 kont); wiekszy zespol -> plan Scale.
    max_staff_members: 9,
  },
  SCALE: {
    max_gallery_records: -1, // Unlimited
    max_pinned_records: 50, // Pinned Photos Differentiation: 3 → 10 → 15 → 30 → 50
    max_paired_clients: -1, // Unlimited
    max_shares_per_hour: -1, // Unlimited
    can_use_session_share: true, // Wszystkie plany
    can_use_multi_session: true, // Wszystkie plany
    can_use_staff_accounts: true, // Staff Accounts + Custom features
    can_view_history: true,
    can_brand_profile: true,
    history_retention_days: -1,
    max_staff_members: -1, // Unlimited
  },
} as const;

// NOTE: Import type only (avoid circular dependency)
export type PlanConfigType = {
  plan_id: string;
  max_gallery_records: number;
  max_pinned_records: number;
  max_paired_clients: number;
  max_shares_per_hour: number;
  can_use_session_share: boolean;
  can_use_multi_session: boolean;
  can_use_staff_accounts: boolean;
  can_view_history: boolean;
  /** Branding-light (BRANDING_VALUE_LADDER krok 1): kolor akcentu profilu. */
  can_brand_profile: boolean;
  history_retention_days: number;
  max_staff_members: number;
};

export type PRICING_POLICY_TYPE = {
  LIMITS: typeof PRICING_LIMITS_SSOT;
  PLATFORM_LIMITS: typeof PLATFORM_LIMITS;
  utils: {
    PRICING_PLAN_VALUE_TYPE_NARROWER: (
      maybePricingPlanValue: unknown
    ) => maybePricingPlanValue is PricingPlan;

    // Quota checks (per-plan — STYLIST limits)
    canCreateGalleryRecord: (
      config: PlanConfigType,
      currentCount: number
    ) => boolean;
    canPairClient: (config: PlanConfigType, currentCount: number) => boolean;
    canPinGalleryRecord: (
      config: PlanConfigType,
      currentPinnedCount: number
    ) => boolean;
    canShareSession: (config: PlanConfigType, currentCount: number) => boolean;

    // Quota checks (platform — CLIENT limits)
    canPairStylist: (currentCount: number) => boolean;

    // Feature flags
    canUseSessionShare: (config: PlanConfigType) => boolean;
    canUseMultiSession: (config: PlanConfigType) => boolean;
    canUseStaffAccounts: (config: PlanConfigType) => boolean;
    canViewHistory: (config: PlanConfigType) => boolean;
    getHistoryRetentionDays: (config: PlanConfigType) => number;

    // Get config for plan
    getPlanConfig: (plan: PricingPlan) => PlanConfigType;
  };
};

export const PRICING_POLICY: PRICING_POLICY_TYPE = {
  LIMITS: PRICING_LIMITS_SSOT,
  PLATFORM_LIMITS,

  utils: {
    PRICING_PLAN_VALUE_TYPE_NARROWER: (
      maybePricingPlanValue
    ): maybePricingPlanValue is PricingPlan => {
      return isPricingPlanNarrower(maybePricingPlanValue);
    },

    // Quota checks (per-plan — STYLIST limits)

    canCreateGalleryRecord: (
      config: PlanConfigType,
      currentCount: number
    ): boolean => {
      return (
        isUnlimitedLimit(config.max_gallery_records) ||
        currentCount < config.max_gallery_records
      );
    },

    canPairClient: (config: PlanConfigType, currentCount: number): boolean => {
      return (
        isUnlimitedLimit(config.max_paired_clients) ||
        currentCount < config.max_paired_clients
      );
    },

    canPinGalleryRecord: (
      config: PlanConfigType,
      currentPinnedCount: number
    ): boolean => {
      return (
        isUnlimitedLimit(config.max_pinned_records) ||
        currentPinnedCount < config.max_pinned_records
      );
    },

    canShareSession: (
      config: PlanConfigType,
      currentCount: number
    ): boolean => {
      return (
        config.can_use_session_share &&
        (isUnlimitedLimit(config.max_shares_per_hour) ||
          currentCount < config.max_shares_per_hour)
      );
    },

    // Quota checks (platform — CLIENT limits)

    canPairStylist: (currentCount: number): boolean => {
      return (
        isUnlimitedLimit(PLATFORM_LIMITS.MAX_PAIRED_STYLISTS) ||
        currentCount < PLATFORM_LIMITS.MAX_PAIRED_STYLISTS
      );
    },

    // Feature flags

    canUseSessionShare: (config: PlanConfigType): boolean => {
      return config.can_use_session_share;
    },

    canUseMultiSession: (config: PlanConfigType): boolean => {
      return config.can_use_multi_session;
    },

    canUseStaffAccounts: (config: PlanConfigType): boolean => {
      return config.can_use_staff_accounts;
    },

    canViewHistory: (config: PlanConfigType): boolean => {
      return config.can_view_history;
    },

    getHistoryRetentionDays: (config: PlanConfigType): number => {
      return config.history_retention_days;
    },

    // Get config for plan (direct access — 4 tiers = 4 keys)
    // DECISION (nie usuwaj): unknown plan → FREE (fail-safe). Nie logujemy tu
    // (shared policy — importowana też przez frontend `main/src/UI/**`, brak reportIssueBackend;
    // dodanie złamałoby shared import). Obserwowalność degradacji po stronie backendowego callera.
    // DECISION (nie usuwaj tego komentarza): rozpoznanie planu idzie przez
    // `isPricingPlanNarrower` (ten sam predykat, co `narrowPricingPlan` niżej), a NIE
    // przez operator `in`. `in` chodzi po łańcuchu prototypów, więc na `'constructor'`,
    // `'toString'`, `'valueOf'` czy `'__proto__'` odpowiadał TWIERDZĄCO i spread zwracał
    // konfigurację, w której KAŻDY limit jest `undefined` — czyli obiekt wyglądający na
    // poprawny plan, a nie bezpieczny fallback do FREE, który ta gałąź obiecuje.
    getPlanConfig: (plan: PricingPlan): PlanConfigType => {
      const key: keyof typeof PRICING_LIMITS_SSOT = isPricingPlanNarrower(plan)
        ? plan
        : 'FREE';
      return { plan_id: plan, ...PRICING_LIMITS_SSOT[key] };
    },
  },
} as const;

/**
 * Narrow a DB string to PricingPlan with FREE fallback.
 * Use instead of `value as PricingPlan` unsafe casts.
 */
// DECISION (nie usuwaj): unknown plan → FREE (fail-safe), tożsame z getPlanConfig.
// Brak logu — shared policy importowana przez frontend (brak reportIssueBackend);
// obserwowalność degradacji po stronie backendowego callera.
export const narrowPricingPlan = (value: string): PricingPlan =>
  isPricingPlanNarrower(value) ? value : PricingPlanValue.FREE;

// DECISION (nie usuwaj tego komentarza):
// ZERO cen hardcoded w kodzie — Stripe = JEDYNE SSOT cen (B37, decyzja usera 2026-05-29).
// Usunięto PLAN_FALLBACK_PRICES_PLN: było drugim źródłem cen (dryf). Wyświetlanie i JSON-LD
// nie podają cen; admin MRR liczy z live cen Stripe (fetchPricingPlans). Gdy Stripe niedostępny:
// PriceSlot → loading/skeleton, MRR → 0 dla planów bez ceny. NIGDY stała/możliwie-nieaktualna cena.
