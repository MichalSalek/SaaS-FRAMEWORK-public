import type { useTranslations } from 'next-intl';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';

/* ─── SSOT alias ─── */
const L = PRICING_POLICY.LIMITS;
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';

/** Converts the SSOT unlimited sentinel to null for display logic. */
const toDisplayCount = (n: number): number | null =>
  isUnlimitedLimit(n) ? null : n;

/* ─── Tier limits shape ─── */

interface TierLimits {
  gallery: number | null;
  clients: number | null;
  pinned: number;
  hasPublicProfile: boolean;
  hasTeamAccounts: boolean;
  /** Liczba kont stylistek (poza właścicielką) — SSOT max_staff_members. */
  staffMembers: number;
  hasQrSharing: boolean;
  /**
   * Zdjęcia bez znaku wodnego — benefit płatnych (FREE ma znak wodny). Derived
   * z tożsamości tieru (plan===FREE), NIE osobne pole kernela (brak w SSOT).
   */
  noWatermark: boolean;
  /**
   * Retencja historii klientek w dniach (SSOT `history_retention_days`):
   * 0 = brak, -1 = pełna (bez limitu), N = ostatnie N dni.
   */
  historyRetentionDays: number;
}

export interface PricingTier {
  id: string;
  /**
   * Kernel plan id — the join key against `PricingPlanCard.id` (prices) and
   * `stylist_account.pricing_plan` (current plan). `id` is a lowercase DOM/key
   * slug and MUST NOT be used for plan lookups ('pro-plus' !== 'PRO_PLUS').
   */
  planId: PricingPlan;
  nameKey: string;
  taglineKey: string;
  limits: TierLimits;
  ctaKey: string;
  badgeKey?: string;
  isTarget?: boolean;
  /**
   * Plan polecany (badge i18n `tierSection.popularBadge`) — steruje
   * frozen-tint wyróżnieniem kolumny/karty w sekcji "Porównaj plany".
   * Osobne od `isTarget` (Studio = target biznesowy z badgem typograficznym).
   */
  isRecommended?: boolean;
  isContact?: boolean;
  /**
   * Karta renderowana w atramentowym bandzie „Pakiety premium" POD jasną parą
   * Free+Pro (głos ownera 2026-07-11: hybryda PR-B+PR-C — siatka 2+2, premium
   * uwypuklone negatywem SEKCJI zamiast negatywu pojedynczej karty Pro).
   * SSOT układu cennika żyje tu, nie w komponencie.
   */
  isPremiumBand?: boolean;
  /**
   * Nota w BODY karty (pod listą cech) — wypełnia pustkę subgrid CTA-align na
   * kartach z krótką listą i pozycjonuje plan (Pro Marka = wymagająca solo, Studio = salon).
   * Głos ownera S42.
   */
  bodyNoteKey?: string;
  /**
   * Dodatkowe wiersze cech dopisane po diffie kumulatywnym (głos ownera S45):
   * plany o krótkim diffie (Studio) dostają realne, SSOT-owe cechy własne, żeby
   * karta była wizualnie „najwięcej wszystkiego", a nie pusty stos spacerów.
   * Klucze i18n bez params (statyczne benefity). NIE fluff — każdy = fakt SSOT.
   */
  bonusFeatureKeys?: string[];
}

export const TIERS: PricingTier[] = [
  {
    id: 'free',
    planId: PricingPlanValue.FREE,
    nameKey: 'tiers.freeName',
    taglineKey: 'tiers.freeTagline',
    limits: {
      gallery: toDisplayCount(L.FREE.max_gallery_records),
      clients: toDisplayCount(L.FREE.max_paired_clients),
      pinned: L.FREE.max_pinned_records,
      hasPublicProfile: true,
      hasTeamAccounts: L.FREE.can_use_staff_accounts,
      staffMembers: L.FREE.max_staff_members,
      hasQrSharing: true,
      noWatermark: false,
      historyRetentionDays: L.FREE.history_retention_days,
    },
    ctaKey: 'tiers.freeCta',
  },
  {
    id: 'pro',
    planId: PricingPlanValue.PRO,
    nameKey: 'tiers.proName',
    taglineKey: 'tiers.proTagline',
    isRecommended: true,
    limits: {
      gallery: toDisplayCount(L.PRO.max_gallery_records),
      clients: toDisplayCount(L.PRO.max_paired_clients),
      pinned: L.PRO.max_pinned_records,
      hasPublicProfile: true,
      hasTeamAccounts: L.PRO.can_use_staff_accounts,
      staffMembers: L.PRO.max_staff_members,
      hasQrSharing: true,
      noWatermark: true,
      historyRetentionDays: L.PRO.history_retention_days,
    },
    ctaKey: 'tiers.proCta',
  },
  {
    id: 'pro-plus',
    planId: PricingPlanValue.PRO_PLUS,
    nameKey: 'tiers.proPlusName',
    taglineKey: 'tiers.proPlusTagline',
    isPremiumBand: true,
    bodyNoteKey: 'tiers.proPlusDecoyNote',
    // Obietnica roadmapy marki jako CECHA na karcie (fresh-eyes 2026-07-11
    // MINOR 4: nota italic dublowała bullety, a lista Pro Marka była za
    // krótka — unikatowy konkret idzie do listy, nota niesie tylko kartę
    // klientki). Ta sama obietnica żyje w makiecie PR-B z głosowania.
    bonusFeatureKeys: ['features.brandingRoadmap'],
    limits: {
      gallery: toDisplayCount(L.PRO_PLUS.max_gallery_records),
      clients: toDisplayCount(L.PRO_PLUS.max_paired_clients),
      pinned: L.PRO_PLUS.max_pinned_records,
      hasPublicProfile: true,
      hasTeamAccounts: L.PRO_PLUS.can_use_staff_accounts,
      staffMembers: L.PRO_PLUS.max_staff_members,
      hasQrSharing: true,
      noWatermark: true,
      historyRetentionDays: L.PRO_PLUS.history_retention_days,
    },
    ctaKey: 'tiers.proPlusCta',
  },
  {
    id: 'studio',
    planId: PricingPlanValue.STUDIO,
    nameKey: 'tiers.studioName',
    taglineKey: 'tiers.studioTagline',
    isTarget: true,
    isPremiumBand: true,
    badgeKey: 'tiers.studioBadge',
    bodyNoteKey: 'tiers.studioBodyNote',
    // Realne benefity salonowe (SSOT DOMAIN §Staff Accounts: subkonta z własnymi
    // loginami, jeden brand; studioBodyNote: wspólny profil + prace zespołu).
    bonusFeatureKeys: [
      'features.perStylistLogin',
      'features.salonProfile',
      'features.teamPortfolio',
    ],
    limits: {
      gallery: toDisplayCount(L.STUDIO.max_gallery_records),
      clients: toDisplayCount(L.STUDIO.max_paired_clients),
      pinned: L.STUDIO.max_pinned_records,
      hasPublicProfile: true,
      hasTeamAccounts: L.STUDIO.can_use_staff_accounts,
      staffMembers: L.STUDIO.max_staff_members,
      hasQrSharing: true,
      noWatermark: true,
      historyRetentionDays: L.STUDIO.history_retention_days,
    },
    ctaKey: 'tiers.studioCta',
  },
  {
    id: 'scale',
    planId: PricingPlanValue.SCALE,
    nameKey: 'tiers.scaleName',
    taglineKey: 'tiers.scaleTagline',
    isContact: true,
    limits: {
      gallery: toDisplayCount(L.SCALE.max_gallery_records),
      clients: toDisplayCount(L.SCALE.max_paired_clients),
      pinned: L.SCALE.max_pinned_records,
      hasPublicProfile: true,
      hasTeamAccounts: L.SCALE.can_use_staff_accounts,
      staffMembers: L.SCALE.max_staff_members,
      hasQrSharing: true,
      noWatermark: true,
      historyRetentionDays: L.SCALE.history_retention_days,
    },
    ctaKey: 'tiers.scaleCta',
  },
];

/* ─── Feature rows for comparison table ─── */

/**
 * next-intl `t` (namespace `static.pricing`). Wartości string niektórych wierszy
 * (retencja historii) są i18n, więc `getValue` dostaje translator; wiersze
 * boolean/liczbowe ignorują 2. argument.
 */
type FeatureRowTranslate = ReturnType<typeof useTranslations>;

export interface FeatureRow {
  labelKey: string;
  getValue: (limits: TierLimits, t: FeatureRowTranslate) => string | boolean;
}

export const FEATURE_ROWS: FeatureRow[] = [
  { labelKey: 'table.labelPublicProfile', getValue: l => l.hasPublicProfile },
  {
    labelKey: 'table.labelStaffCapacity',
    getValue: (l, t) =>
      l.staffMembers < 0 ? t('table.unlimitedStaff') : String(l.staffMembers),
  },
  {
    labelKey: 'table.labelGallery',
    getValue: l => (l.gallery === null ? '∞' : String(l.gallery)),
  },
  {
    labelKey: 'table.labelClients',
    getValue: l => (l.clients === null ? '∞' : String(l.clients)),
  },
  { labelKey: 'table.labelPinned', getValue: l => String(l.pinned) },
  { labelKey: 'table.labelQr', getValue: l => l.hasQrSharing },
  { labelKey: 'table.labelTeam', getValue: l => l.hasTeamAccounts },
  { labelKey: 'table.labelWatermark', getValue: l => l.noWatermark },
  {
    labelKey: 'table.labelHistory',
    getValue: (l, t) => {
      if (l.historyRetentionDays === 0) {
        return false;
      }
      // Bez limitu = pełna retencja; N > 0 = ostatnie N dni (liczba z SSOT, i18n copy).
      return isUnlimitedLimit(l.historyRetentionDays)
        ? t('table.historyFull')
        : t('table.historyRecent', { days: l.historyRetentionDays });
    },
  },
];

/* ─── Tier feature list keys (pełna enumeracja per plan) ─── */

export interface TierFeatureResult {
  key: string;
  /** interpolation params when key contains {count} lub {days} */
  params?: Record<string, string | number>;
}

/**
 * Pełna lista cech planu (owner S81: „wymień WSZYSTKO co ma każdy plan", zero
 * odniesień „Wszystko z X" — klient widzi realną wartość, wizualnie więcej za co
 * płaci). Wyprowadzona w całości z `tier.limits` (SSOT = PRICING_POLICY) → zero
 * driftu blisko płatności. JEDEN generator cech: główna tabela /pricing ORAZ
 * teasery LP (for-stylists/for-studios) czytają to samo źródło. Pinned CELOWO
 * poza listą — liczba przypiętych wzorów żyje w JEDNYM miejscu na karcie
 * (`.tierPinnedInfo` pod ceną, każda karta — census S22), nie w bulletach.
 */
export function getTierFeatureResults(tier: PricingTier): TierFeatureResult[] {
  if (tier.isContact) {
    return [
      { key: 'features.scaleFeature1' },
      { key: 'features.scaleFeature2' },
      { key: 'features.scaleFeature3' },
      { key: 'features.scaleFeature4' },
      { key: 'features.scaleFeature5' },
    ];
  }

  const results: TierFeatureResult[] = [];
  const l = tier.limits;

  // Galeria
  results.push(
    l.gallery === null
      ? { key: 'features.unlimitedGallery' }
      : { key: 'features.galleryCount', params: { count: l.gallery } }
  );
  // Klientki
  results.push(
    l.clients === null
      ? { key: 'features.unlimitedClients' }
      : { key: 'features.clientsCount', params: { count: l.clients } }
  );
  // Zdjęcia bez znaku wodnego (benefit płatnych — FREE ma znak wodny)
  if (l.noWatermark) {
    results.push({ key: 'features.noWatermark' });
  }
  // Historia klientek (0 = brak, bez limitu = pełna „na zawsze", N = ostatnie N dni)
  if (l.historyRetentionDays !== 0) {
    results.push(
      isUnlimitedLimit(l.historyRetentionDays)
        ? { key: 'features.fullHistory' }
        : {
            key: 'features.historyDays',
            params: { days: l.historyRetentionDays },
          }
    );
  }
  // Kod QR w salonie
  if (l.hasQrSharing) {
    results.push({ key: 'features.qrSharing' });
  }
  // Konta zespołu (pojemność z SSOT max_staff_members)
  if (l.hasTeamAccounts) {
    results.push({
      key: 'features.teamCount',
      params: { count: l.staffMembers },
    });
  }
  // Profil publiczny
  if (l.hasPublicProfile) {
    results.push({ key: 'features.publicProfile' });
  }
  // Pinned CELOWO poza listą (żyje w .tierPinnedInfo pod ceną — census S22).

  // Bonusowe cechy własne planu (SSOT — brand roadmap Pro Marka, benefity salonowe Studio).
  if (tier.bonusFeatureKeys) {
    for (const key of tier.bonusFeatureKeys) {
      results.push({ key });
    }
  }

  return results;
}

/* ─── FAQ Data — keys only ─── */

export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

export const PRICING_FAQ: FaqItem[] = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
  { questionKey: 'faq.q7', answerKey: 'faq.a7' },
  { questionKey: 'faq.q8', answerKey: 'faq.a8' },
];
