import { DB_CLIENT } from '@app/db/db.client';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import { VALIDATION_PAGINATION } from '@kernel/policies/validation.config';

/**
 * Rozmiar portfolio stylistki pokazywany publicznie: wszystkie prace NIEUKRYTE przez
 * moderację, liczone z bazy.
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-25, skorygowane tego samego dnia:
 * publiczna liczba prac (profil `gallery_records_count`, lista `photo_count`, mapa
 * `gallery_count`, zapisane stylistki) = nieukryte prace stylistki, BEZ filtra
 * przypięcia i BEZ sufitu planu. To prawdziwy fakt o portfolio: te prace istnieją, a
 * połączona klientka widzi je wszystkie (także po obniżeniu planu). Profil nie obiecuje
 * więcej, niż pokazuje, bo mówi to wprost: „Wyróżnione prace (N)” nad siatką przypiętych
 * i „+ jeszcze M w pełnej galerii” (DECISION w StylistProfileGallery.organism.tsx).
 * Pierwsza wersja tej poprawki cięła liczbę do przypiętych i zabijała tę zapowiedź, czyli
 * zaniżała prawdziwy dowód społeczny. Liczymy z bazy zamiast z `cached_gallery_count`,
 * bo cache wlicza prace ukryte przez moderację i bywa nieświeży.
 */

// DECISION (nie usuwaj tego komentarza) — przeniesione z gallery-public.operations.ts:
// sufit dla hipotetycznego planu z `max_pinned_records: -1` („bez limitu", patrz
// canPinGalleryRecord). Dziś żaden plan tak nie ma, ale tej wartości NIE wolno
// przepuścić do Prismy: `take: -1` znaczy tam „licz od końca", nie „bez limitu".
// Wartość = kanoniczny sufit strony publicznej z jądra.
const UNLIMITED_PLAN_PUBLIC_GALLERY_TAKE =
  VALIDATION_PAGINATION.LIMIT_MAX_BROWSE;

/** Sufit publicznej galerii dla planu = limit pinów (jedna władza nad liczbą). */
export const resolvePublicGalleryCeiling = (
  pricingPlan: PricingPlan
): number => {
  const planPinLimit =
    PRICING_POLICY.LIMITS[narrowPricingPlan(pricingPlan)].max_pinned_records;
  return planPinLimit < 0 ? UNLIMITED_PLAN_PUBLIC_GALLERY_TAKE : planPinLimit;
};

type PublicCountSubject = { account_id: string };

/** Nieukryte prace: dokładnie to, co widzi połączona klientka. */
const PUBLIC_PORTFOLIO_WHERE = { is_hidden: false } as const;

/**
 * Liczby prac dla wielu kont JEDNYM zapytaniem (groupBy po `created_by_account_id`)
 * — bez N+1 na listach. Konto bez prac dostaje 0. Rzuca przy błędzie bazy: wołający
 * jest w swoim `try` i mapuje to jak każdy inny odczyt.
 */
export const countPublicGalleryRecordsByAccount = async (
  accounts: readonly PublicCountSubject[]
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (accounts.length === 0) {
    return counts;
  }
  const accountIds = [...new Set(accounts.map(a => a.account_id))];
  const grouped = await DB_CLIENT.use.galleryRecord.groupBy({
    by: ['created_by_account_id'],
    where: {
      created_by_account_id: { in: accountIds },
      ...PUBLIC_PORTFOLIO_WHERE,
    },
    _count: { _all: true },
  });
  const byAccount = new Map(
    grouped.map(row => [row.created_by_account_id, row._count._all])
  );
  for (const account of accounts) {
    counts.set(account.account_id, byAccount.get(account.account_id) ?? 0);
  }
  return counts;
};

/** Wariant dla jednego konta (profil publiczny). */
export const countPublicGalleryRecords = async (
  account: PublicCountSubject
): Promise<number> =>
  DB_CLIENT.use.galleryRecord.count({
    where: {
      created_by_account_id: account.account_id,
      ...PUBLIC_PORTFOLIO_WHERE,
    },
  });
