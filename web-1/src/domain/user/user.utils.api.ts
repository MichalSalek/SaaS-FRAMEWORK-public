import { handlePromiseWithTimeout } from '@msalek/utils';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getCountryAndCity } from '@app/geolocalization/geo.utils';
import type { Session } from '@kernel/models/db_models.generated.dto';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import { narrowUserMetadata } from '@kernel/models/type_narrowing';
import type {
  CurrentUser,
  UserWithRelations,
} from '@kernel/models/user/user.types';
import type {
  SafeCurrentUser,
  SafeStylistAccount,
} from '@kernel/models/session/session.dto';

export const makeCurrentUser = ({
  user,
  session,
}: {
  user: UserWithRelations;
  session: Session;
}): CurrentUser => {
  return {
    ...user,
    session,
  };
};

// DECISION (nie usuwaj tego komentarza):
// Single sanitizer dla każdej response body wracającej CurrentUser. Strip'uje
// `session.token` (bearer credential — ~30d persistent, kradzież = pełna sesja)
// oraz `session.userId` (redundantne wzgl. currentUser.id, brak wartości po stronie
// klienta). Token persists w Authorization header (out-of-band) + DB row.
// MUSI być użyty w KAŻDYM handlerze respondującym CurrentUser do klienta:
// - admin/become-user
// - admin/switch-back-become-user
// - auth/dev-login
// - session/get-current
// SSOT shape: `SafeCurrentUser` w `.shared-kernel/models/session/session.dto.ts`.
// Relacje doładowane przez `userRelationsEnabler` na potrzeby zapytań, których
// `SafeCurrentUser` NIE deklaruje. Spread przepuszczał je do response body, a
// TypeScript tego nie widział: nadmiarowe pola nie są sprawdzane przy spreadzie,
// więc kontrakt „compile-time" mijał się z tym, co faktycznie leciało po HTTP.
// UI ma na te listy własne, paginowane endpointy.
const RELATIONS_OUTSIDE_CONTRACT = [
  'sessions',
  'favorite_stylists',
  'favorite_records',
] as const;

// DECISION (nie usuwaj tego komentarza) — 2026-09-25: `stylist_account` wraca
// do klienta jako ALLOWLISTA, nie spread wiersza (uzasadnienie i lista pól:
// SafeStylistAccount w session.dto.ts). Mapa jest typowana
// `Record<keyof SafeStylistAccount, true>`, więc kompilator pilnuje parytetu w
// OBIE strony: pole dopisane do typu bez wpisu tutaj albo wpis bez pola w typie
// = błąd kompilacji. Serwerowy include (`userRelationsEnabler`) CELOWO zostaje
// pełny — handlery czytają z `currentUser.stylist_account` pola spoza tej listy
// (plan, Stripe, liczniki), a zawężenie zapytania zabrałoby je logice serwera.
const SAFE_STYLIST_ACCOUNT_FIELDS: Record<keyof SafeStylistAccount, true> = {
  account_id: true,
  display_name: true,
  business_name: true,
  address_street: true,
  address_city: true,
  address_postal_code: true,
  address_country: true,
  phone: true,
  website: true,
  description: true,
  vanity_url: true,
  instagram_handle: true,
  avatar_url: true,
  brand_accent_color: true,
  view_count: true,
  pricing_plan: true,
  payment_status: true,
  account_status: true,
  plan_selected_at: true,
  subscription_status: true,
  cancel_at_period_end: true,
  cancel_at: true,
  current_period_end: true,
  trial_started_at: true,
  trial_ends_at: true,
  admin_plan_override: true,
  email_preferences: true,
};

const SAFE_STYLIST_ACCOUNT_KEYS = Object.keys(
  SAFE_STYLIST_ACCOUNT_FIELDS
) as (keyof SafeStylistAccount)[];

const toSafeStylistAccount = (
  account: SafeStylistAccount
): SafeStylistAccount => {
  const projected: Partial<Record<keyof SafeStylistAccount, unknown>> = {};
  for (const key of SAFE_STYLIST_ACCOUNT_KEYS) {
    projected[key] = account[key];
  }
  return projected as SafeStylistAccount;
};

export const toSafeCurrentUser = (
  currentUser: CurrentUser
): SafeCurrentUser => {
  const {
    session: { token: _token, userId: _userId, ...safeSession },
    stylist_account,
    ...userData
  } = currentUser;

  // Projekcja, nie sam spread: sanitizer ma być GRANICĄ kontraktu, więc zdejmuje
  // wszystko, czego `SafeCurrentUser` nie obiecuje.
  const projected = { ...userData } as Record<string, unknown>;
  for (const key of RELATIONS_OUTSIDE_CONTRACT) {
    delete projected[key];
  }

  return {
    ...(projected as Omit<CurrentUser, 'session' | 'stylist_account'>),
    stylist_account:
      stylist_account === null ? null : toSafeStylistAccount(stylist_account),
    session: safeSession,
  };
};

export const fillUserMetadataWithLocation = async (
  body: Partial<UserMetadata> | unknown
): Promise<UserMetadata> => {
  const maybeUserMetadata = narrowUserMetadata(
    body,
    'getUserMetadataFromRequest'
  );
  const userMetadata: UserMetadata = {
    user_agent: maybeUserMetadata.user_agent,
    language: maybeUserMetadata.language,
    client_ip: maybeUserMetadata.client_ip,
    location: null,
  };

  try {
    userMetadata.location =
      (await handlePromiseWithTimeout<string | null>(
        getCountryAndCity({ client_ip: maybeUserMetadata.client_ip ?? null })
      )) ?? null;
    return userMetadata;
  } catch (e) {
    reportIssueBackend({
      namespace: 'fillUserMetadataWithLocation',
      message: `error.`,
      payload: e,
      mode: 'error',
    });
    return userMetadata;
  }
};
