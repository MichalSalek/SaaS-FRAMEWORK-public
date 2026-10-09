import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  User,
  StylistAccount,
  AccountType,
} from '../db_models.generated.dto';
import type { SystemRoleIdType } from '../db_models.manual.dto';
import type { SafeCurrentUser } from '../session/session.dto';
import type { PricingPlan } from '../../domain/pricing/pricing.config';

// ── GDPR Art.20 data-export collection shapes ──────────────────────────────
// DECISION (nie usuwaj tego komentarza):
// Kompletność Art.20: eksport OBEJMUJE każdą kolekcję danych autorstwa użytkownika
// (crm-notatki, wizyty + zdjęcia efektów, wątki supportu, notatki dashboardu,
// preferencje powiadomień, kontenery sesji) w „basic" kształcie FK->NAZWY (NIE
// surowy graf relacyjny / zagnieżdżone ID), cap COLLECTION_LIMIT per kolekcja.
// Typy poniżej opisują ten kształt; kolektory (web-1 export-user-data.collectors*)
// budują dane wg nich. `data` w USER_EXPORT_DATA pozostaje otwartą kopertą (Record)
// bo montaż jest POLIMORFICZNY: konto pojedyncze = pola płaskie, konto podwójne =
// zagnieżdżone pod stylist_account/client_account (isDual). ContentReport celowo
// POMINIĘTY (rekord moderacyjny, osobny scope).
export type UserExportVisitPhoto = {
  asset_url: string;
  position: number;
};

export type UserExportVisit = {
  client_name: string;
  visit_date: string;
  service_note: string | null;
  source: string;
  created_at: string;
  result_photos: UserExportVisitPhoto[];
};

export type UserExportCrmNote = {
  client_name: string;
  crm_note: string | null;
  updated_at: string | null;
};

export type UserExportSessionContainer = {
  client_name: string;
  name: string | null;
  lifecycle_state: string;
  stylist_note: string | null;
  client_note: string | null;
  shared_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type UserExportSupportMessage = {
  content: string;
  created_at: string;
};

export type UserExportSupportThread = {
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
  messages: UserExportSupportMessage[];
};

/** GDPR Art.20: wiadomości komunikatora stylistka<->klientka AUTORSTWA usera
 *  (parytet support: eksportujemy stronę usera, nie drugiej osoby). Grupowane
 *  per konwersacja (counterpart = NAZWA, basic-shape FK->nazwa). */
export type UserExportConversation = {
  counterpart_name: string;
  pair_status: string;
  messages: UserExportSupportMessage[];
};

export type UserExportNotificationPreferences = {
  notifications_enabled: boolean;
  email_marketing: boolean | null;
  email_trial_sequence: boolean | null;
  /** First acceptance of terms + 16+ declaration (ISO); null = not recorded. */
  terms_accepted_at: string | null;
};

export type USER_DTO_API_V1 = {
  /** Logowanie deweloperskie po adresie email (tylko środowisko dev); zwraca sesję bieżącego użytkownika. */
  DEV_LOGIN: {
    REQUEST: { email: string };
    RESPONSE: SafeCurrentUser;
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['DEV_LOGIN']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['DEV_LOGIN']['REQUEST'],
      USER_DTO_API_V1['DEV_LOGIN']['RESPONSE'],
      USER_DTO_API_V1['DEV_LOGIN']['RESPONSE_ERROR']
    >;
  };

  // DECISION (nie usuwaj tego komentarza):
  // Po F2 dedup usunięto CREATE/ENABLE_SELF/DELETE_SELF/CHANGE_EMAIL — duplikaty
  // (CREATE/ENABLE_SELF: out-of-band Better Auth, brak CQRS handlerów;
  // DELETE_SELF → REQUEST_DELETE, CHANGE_EMAIL → REQUEST_EMAIL_CHANGE: identyczne kontrakty,
  // ujednolicono na REQUEST_* nazewnictwo zgodne z eventami w APP_EVENTS).

  // DECISION (nie usuwaj tego komentarza):
  // USER_LOGOUT = placeholder DTO wymagany przez inwariant dto-completeness
  // (każdy event CQRS ma blok DTO). Klucz == event (P-pełny). Op NIE ma własnej
  // trasy ani metody — aliased do SESSION_DELETE_ALL endpoint (http.endpoints
  // ROUTE_ALIASES; logout właściwy = Better Auth out-of-band). Dlatego pure-equality
  // guard (dto-op ↔ registry) trzyma go jako udokumentowany ALIASED_OP wyjątek.
  USER_LOGOUT: {
    REQUEST: Record<string, never>;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      Record<string, never>,
      undefined,
      DetailedErrorPayload<undefined>
    >;
  };

  /** Dezaktywuje własne konto użytkownika; operacja idempotentna, odwracalna wyłącznie przez administratora. */
  USER_DISABLE_SELF: {
    REQUEST: Record<string, never>;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_DISABLE_SELF']['REQUEST'],
      USER_DTO_API_V1['USER_DISABLE_SELF']['RESPONSE'],
      USER_DTO_API_V1['USER_DISABLE_SELF']['RESPONSE_ERROR']
    >;
  };

  /** Zmienia nazwę wyświetlaną użytkownika; zwraca id oraz zapisaną nazwę. */
  USER_CHANGE_NAME: {
    REQUEST: Pick<User, 'name'>;
    RESPONSE: Pick<User, 'id' | 'name'>;
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST'],
      USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE'],
      USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE_ERROR']
    >;
  };

  /** Zakłada konto stylistki dla użytkownika (nazwa, miasto, opcjonalny telefon i zgoda marketingowa); zwraca id konta. */
  USER_ONBOARD_AS_STYLIST: {
    REQUEST: Pick<StylistAccount, 'display_name' | 'address_city'> & {
      phone?: string | null | undefined;
      // Optional marketing consent captured at onboarding (default false when
      // omitted — consent-safe). Frontend always sends it; smoke/test callers may omit.
      email_marketing?: boolean;
      // Optional Instagram account name (no „@”), stored as
      // StylistAccount.instagram_handle and preferred as the base of the
      // auto-assigned public profile address (owner 2026-09-23).
      instagram_handle?: string | null | undefined;
      // Explicit acceptance of terms + the 16+ declaration (one consent row in
      // the role step). Optional so deploy order does not matter; the backend
      // stamps User.terms_accepted_at only on `true` and only once.
      terms_accepted?: boolean;
    };
    RESPONSE: { stylist_account_id: string };
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST'],
      USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['RESPONSE'],
      USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['RESPONSE_ERROR']
    >;
  };

  /** Zakłada konto klientki dla bieżącego użytkownika; zwraca id utworzonego konta. */
  USER_ONBOARD_AS_CLIENT: {
    // terms_accepted: same consent as in USER_ONBOARD_AS_STYLIST.
    REQUEST: { terms_accepted?: boolean };
    RESPONSE: { client_account_id: string };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['REQUEST'],
      USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['RESPONSE'],
      USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca stan konta: rolę, obecność konta stylistki i klientki oraz czy wymagany jest onboarding. */
  USER_GET_ACCOUNT_STATE: {
    REQUEST: Record<string, never>;
    RESPONSE: {
      role_id: SystemRoleIdType;
      has_stylist_account: boolean;
      has_client_account: boolean;
      needs_onboarding: boolean;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['REQUEST'],
      USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['RESPONSE'],
      USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca liczniki wykorzystania (galeria, sparowania, udostępnienia), limity oraz aktualny plan cenowy. */
  USER_GET_USAGE_STATS: {
    REQUEST: Record<string, never>;
    RESPONSE: {
      gallery_records: number;
      favorite_stylists: number;
      paired_clients: number;
      hourly_shares: number;
      favorite_records_count: number;
      pinned_records: number;
      limits: {
        max_gallery_records: number;
        max_paired_stylists: number; // Platform limit (CLIENT, not per-plan) — from PLATFORM_LIMITS
        max_paired_clients: number;
        max_shares_per_hour: number;
        max_pinned_records: number;
        can_use_session_share: boolean;
        can_use_multi_session: boolean;
        can_use_staff_accounts: boolean;
      };
      pricing_plan: PricingPlan;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_GET_USAGE_STATS']['REQUEST'],
      USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE'],
      USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE_ERROR']
    >;
  };

  /** Przełącza aktywną rolę między istniejącym kontem stylistki a klientki (rezerwa pod konta podwójne). */
  USER_SWITCH_ROLE: {
    REQUEST: { account_type: AccountType };
    RESPONSE: { success: boolean; account_type: AccountType };
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_SWITCH_ROLE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_SWITCH_ROLE']['REQUEST'],
      USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE'],
      USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE_ERROR']
    >;
  };

  /** Sonduje odzyskanie konta po adresie email; zwraca jednolitą odpowiedź niezależnie od konta (ochrona przed enumeracją). */
  USER_CHECK_RECOVERY: {
    REQUEST: { email: string };
    RESPONSE: {
      recovery_available: boolean;
      deleted_at: string | null;
      days_left: number | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_CHECK_RECOVERY']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_CHECK_RECOVERY']['REQUEST'],
      USER_DTO_API_V1['USER_CHECK_RECOVERY']['RESPONSE'],
      USER_DTO_API_V1['USER_CHECK_RECOVERY']['RESPONSE_ERROR']
    >;
  };

  /** Odtwarza usunięte konto z kopii zapasowej; zwraca typ przywróconego konta i liczbę odzyskanych wpisów galerii. */
  USER_RESTORE_ACCOUNT: {
    REQUEST: Record<string, never>;
    RESPONSE: {
      success: boolean;
      restored_account_type: AccountType | null;
      gallery_records_restored: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_RESTORE_ACCOUNT']['REQUEST'],
      USER_DTO_API_V1['USER_RESTORE_ACCOUNT']['RESPONSE'],
      USER_DTO_API_V1['USER_RESTORE_ACCOUNT']['RESPONSE_ERROR']
    >;
  };

  // ADRR Model A: reactivate own soft-deleted (RECOVERABLE) account in-place.
  // POST, auth required, empty body (userId from session). Returns reactivated flag.
  USER_REACTIVATE_ACCOUNT: {
    REQUEST: Record<string, never>;
    RESPONSE: { reactivated: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['REQUEST'],
      USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE'],
      USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE_ERROR']
    >;
  };

  // ADRR Model A: GDPR Art. 17 — permanent erasure on explicit request.
  // POST, auth required, empty body (userId from session). Only path to hard-delete.
  USER_GDPR_ERASE: {
    REQUEST: Record<string, never>;
    RESPONSE: { erased: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_GDPR_ERASE']['REQUEST'],
      USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE'],
      USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE_ERROR']
    >;
  };

  /** Eksportuje komplet danych użytkownika (portowalność RODO) z wersją eksportu i znacznikiem czasu. */
  USER_EXPORT_DATA: {
    REQUEST: Record<string, never>;
    RESPONSE: {
      export_version: string;
      exported_at: string;
      account_type: AccountType;
      user: {
        email: string;
        name: string;
        created_at: string;
        account_type: AccountType;
      };
      // Otwarta koperta (patrz DECISION przy UserExport* typach wyżej): montaż
      // POLIMORFICZNY (flat / isDual-nested) + user-level kolekcje (activity_log,
      // newsletter_subscription, support_threads: UserExportSupportThread[],
      // notification_preferences: UserExportNotificationPreferences). Element-typy
      // każdej kolekcji są nazwane wyżej i egzekwowane w kolektorach (miejsce montażu).
      data: Record<string, unknown>;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_EXPORT_DATA']['REQUEST'],
      USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE'],
      USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE_ERROR']
    >;
  };

  /** Ustawia preferencję powiadomień użytkownika (włączone albo wyłączone); zwraca zapisaną wartość. */
  USER_UPDATE_NOTIFICATION_PREFERENCES: {
    REQUEST: { notifications_enabled: boolean };
    RESPONSE: { notifications_enabled: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['REQUEST'],
      USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['RESPONSE'],
      USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['RESPONSE_ERROR']
    >;
  };

  /** Inicjuje usunięcie konta: wysyła wiadomość z jednorazowym linkiem potwierdzającym; zwraca ogólny komunikat. */
  USER_REQUEST_DELETE: {
    REQUEST: Record<string, never>;
    RESPONSE: { message: string };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_REQUEST_DELETE']['REQUEST'],
      USER_DTO_API_V1['USER_REQUEST_DELETE']['RESPONSE'],
      USER_DTO_API_V1['USER_REQUEST_DELETE']['RESPONSE_ERROR']
    >;
  };

  /** Potwierdza usunięcie konta jednorazowym tokenem z linku (GET, bez uwierzytelnienia); zwraca flagę potwierdzenia. */
  USER_DELETE_CONFIRM: {
    REQUEST: { token: string };
    RESPONSE: { confirmed: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_DELETE_CONFIRM']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_DELETE_CONFIRM']['REQUEST'],
      USER_DTO_API_V1['USER_DELETE_CONFIRM']['RESPONSE'],
      USER_DTO_API_V1['USER_DELETE_CONFIRM']['RESPONSE_ERROR']
    >;
  };

  /** Inicjuje zmianę adresu email: wysyła link weryfikacyjny na nowy adres; zwraca ogólny komunikat. */
  USER_REQUEST_EMAIL_CHANGE: {
    REQUEST: Pick<User, 'email'>;
    RESPONSE: { message: string };
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['REQUEST'],
      USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['RESPONSE'],
      USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['RESPONSE_ERROR']
    >;
  };

  /** Potwierdza zmianę adresu email jednorazowym tokenem z linku (GET, bez uwierzytelnienia); zwraca flagę potwierdzenia. */
  USER_EMAIL_CHANGE_CONFIRM: {
    REQUEST: { token: string };
    RESPONSE: { confirmed: boolean };
    RESPONSE_ERROR: DetailedErrorPayload<
      USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['REQUEST'],
      USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['RESPONSE'],
      USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['RESPONSE_ERROR']
    >;
  };
};
