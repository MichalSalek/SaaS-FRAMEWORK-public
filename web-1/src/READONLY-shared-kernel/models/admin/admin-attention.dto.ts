import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';

// Attention counts — liczniki "rzeczy czekających na admina" per pozycja menu
// panelu (badge w sidebarze AdminLayout). Klucze = źródła kolejek, nie trasy:
// jedna pozycja menu mapuje się na jeden licznik w configu sidebara frontu.
export type AdminAttentionCountsResponse = {
  // Wątki supportu ze statusem OPEN, w których OSTATNIA wiadomość pochodzi od
  // usera (czekają na odpowiedź supportu). Sam status OPEN to za mało — wątek
  // odpisany przez admina, a czekający na usera, nie powinien świecić badge'a.
  support_awaiting_reply: number;
  // Zgłoszenia moderacyjne w statusie PENDING (kolejka do rozpatrzenia).
  moderation_pending: number;
  // Usługi healthchecku w statusie degraded albo down (baza główna, baza
  // logów, Stripe, Cloudinary, serwis email). Pomija usługi bez konfiguracji.
  // Ten sam snapshot co ADMIN_HEALTH, trzymany w cache procesu ~60s, żeby
  // poll badge'a nie odpalał zewnętrznych sprawdzeń przy każdym odświeżeniu.
  system_health_issues: number;
  // Error-log groups inside LOG_ATTENTION_SCOPE (type=error, PRODUCTION, last
  // 7 days) whose display status is in LOG_ISSUE_ATTENTION_STATUSES: never
  // triaged (`new`) or `fixed` and seen again after the mark (`regressed`).
  // `known` and `ignored` are decisions already taken and are NOT counted.
  // List: ADMIN_GET_LOG_GROUPS with `attention: true` (adminLogsAttentionHref).
  log_issues_open: number;
  // USERS whose stylist account has subscription_status PAST_DUE, UNPAID or
  // INCOMPLETE, or is TRIALING with trial_ends_at within the next
  // ADMIN_ATTENTION.TRIAL_ENDING_WITHIN_DAYS days.
  // List: ADMIN_GET_USERS_PAGINATED with `attention: 'payments'`.
  payments_attention: number;
  // Active, not deleted users with neither a stylist nor a client account,
  // registered between STUCK_MAX_AGE_DAYS days and STUCK_MIN_AGE_HOURS hours
  // ago. List: ADMIN_GET_USERS_PAGINATED with `attention: 'stuck'`.
  stuck_accounts: number;
  // 1 when the newest EMAIL_SWEEP_COMPLETED row is missing or older than
  // ADMIN_ATTENTION.EMAIL_SWEEP_MAX_SILENCE_HOURS (measured up to the last
  // moment mail was allowed to go out, so quiet hours alone never fire it),
  // otherwise 0. Screen: the admin email schedule page ("last sweep").
  email_sweep_issues: number;
};

export type AdminAttentionDtoApi = {
  /** Zwraca liczniki uwagi admina (wsparcie, moderacja, zdrowie systemu, grupy logów do reakcji, płatności, utknięte rejestracje, cisza wysyłki maili). */
  ADMIN_GET_ATTENTION_COUNTS: {
    REQUEST: undefined;
    RESPONSE: AdminAttentionCountsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      AdminAttentionCountsResponse,
      DetailedErrorPayload<undefined>
    >;
  };
};
