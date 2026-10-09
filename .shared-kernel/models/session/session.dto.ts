import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { Session, StylistAccount, User } from '../db_models.generated.dto';
import type { CurrentUser } from '../user/user.types';

// DECISION (nie usuwaj tego komentarza):
// SafeSession = Session bez `token` i `userId`. SSOT-owy kontrakt dla każdej
// response wracającej shape sesji (GET_CURRENT, BECOME_USER, SWITCH_BACK_BECOME_USER,
// DEV_LOGIN, GET_ALL). Token bearer persists tylko w Authorization header jednego
// device + DB row — nigdy w response body. `userId` redundantny względem
// `currentUser.id` na poziomie ścieżki CurrentUser.
// Patrz `web-1/src/pages/api/v1/session/get-current/index.ts:35-44` — referencyjny
// wzór strippowania (destructure + spread bez pól wrażliwych).
export type SafeSession = Omit<Session, 'token' | 'userId'>;

// SafeCurrentUser — CurrentUser z SafeSession zamiast surowej Session.
// Wszystkie endpointy zwracające CurrentUser do klienta MUSZĄ używać tego typu,
// nigdy surowego CurrentUser (który zawiera Session.token).
//
// DECISION (nie usuwaj tego komentarza):
// ADRR Model A (§13.1) — `recovery_available` i `deleted_at` są CELOWO eksponowane
// w tej response (przez spread `User`, Inc1 dodał kolumny). Frontend post-login
// czyta je z `currentUser` by policzyć stan konta + days_left i wyrenderować ekran
// restore (RECOVERABLE → 1-click reactivate, EXPIRED → GDPR-delete). Stan liczony
// jest klient-side z 2 pól (kontrakt, nie surowy enum):
//   - ACTIVE:      is_active=true,  deleted_at=null, recovery_available=false
//   - RECOVERABLE: is_active=false, deleted_at=set,  recovery_available=true
//   - EXPIRED:     is_active=false, deleted_at=set,  recovery_available=false
// NIE strip'uj tych pól jako "PII over-exposure" — są niezbędne dla recovery routing,
// a soft-deleted user widzi tylko własny stan (post-login, zero enumeration).
// DECISION (nie usuwaj tego komentarza) — 2026-09-25:
// `stylist_account` w odpowiedzi CurrentUser to PROJEKCJA, nie cały wiersz.
// Middleware ładuje pełny StylistAccount (serwer go potrzebuje: plan, Stripe,
// liczniki), a odpowiedź oddawała go spreadem w całości — właścicielce konta
// leciały `stripe_customer_id`, `subscription_id`, `avatar_public_id`,
// `last_stripe_event_at`, `trial_reminder_sent`, `dashboard_note`, współrzędne,
// kolumny zgód i wszystkie liczniki `cached_*`, których front nie czyta.
// Lista niżej = DOKŁADNIE pola czytane przez `main/src` z bieżącego użytkownika
// (zmierzone kompilatorem: typ zawężony do zera, `tsc` wyliczył każdy odczyt)
// plus to, czego potrzebuje USER_POLICY (account_status, plan_selected_at).
// `admin_plan_override` i `email_preferences` ZOSTAJĄ, bo front je czyta
// (bramka planu w useOnboardingPlanGuard — konto przyznane przez admina nie
// wraca na onboarding; przełączniki powiadomień na ekranie konta). Nowe pole
// w UI = dopisz je TUTAJ; projekcję w web-1 (`toSafeCurrentUser`) wymusza ten
// typ (mapa `Record<keyof SafeStylistAccount, true>`), więc drugi raz nie
// trzeba go wyliczać.
export type SafeStylistAccount = Pick<
  StylistAccount,
  // tożsamość i wizytówka
  | 'account_id'
  | 'display_name'
  | 'business_name'
  | 'address_street'
  | 'address_city'
  | 'address_postal_code'
  | 'address_country'
  | 'phone'
  | 'website'
  | 'description'
  | 'vanity_url'
  | 'instagram_handle'
  | 'avatar_url'
  | 'brand_accent_color'
  | 'view_count'
  // stan planu widoczny w UI (bramki, baner triala, ekran płatności)
  | 'pricing_plan'
  | 'payment_status'
  | 'account_status'
  | 'plan_selected_at'
  | 'subscription_status'
  | 'cancel_at_period_end'
  | 'cancel_at'
  | 'current_period_end'
  | 'trial_started_at'
  | 'trial_ends_at'
  | 'admin_plan_override'
  // preferencje e-mail (przełączniki na ekranie konta)
  | 'email_preferences'
>;

export type SafeCurrentUser = Omit<
  CurrentUser,
  'session' | 'stylist_account'
> & {
  session: SafeSession;
  stylist_account: SafeStylistAccount | null;
};

// DECISION (nie usuwaj tego komentarza):
// Session.token NIGDY nie leakuje przez HTTP — ani w response (GET_ALL),
// ani w request body (DELETE_EXACTLY). Identifier = Session.id (DB PK).
// "is_current" flag computed server-side (porownanie z currentUser.session.id).
// Token persists tylko w DB + Authorization header jednego device. Eliminuje
// cross-device token harvest via XSS/extension (token bearera = ~30d persistent
// credential w Better Auth). Network logs / Sentry replays / browser devtools
// nie expose'uja tokenow przy session-management akcjach.
export type SESSION_DTO_API_V1 = {
  /** Usuwa dokładnie jedną sesję bieżącego usera po Session.id (wylogowanie jednego urządzenia). */
  SESSION_DELETE_EXACTLY: {
    REQUEST: Pick<Session, 'id'>;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST'],
      SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['RESPONSE'],
      SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['RESPONSE_ERROR']
    >;
  };

  /** Usuwa wszystkie sesje usera (bez body własne; MASTER_ADMIN może wskazać innego usera po id). */
  SESSION_DELETE_ALL: {
    REQUEST: Pick<User, 'id'> | undefined;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<
      SESSION_DTO_API_V1['SESSION_DELETE_ALL']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_DTO_API_V1['SESSION_DELETE_ALL']['REQUEST'],
      SESSION_DTO_API_V1['SESSION_DELETE_ALL']['RESPONSE'],
      SESSION_DTO_API_V1['SESSION_DELETE_ALL']['RESPONSE_ERROR']
    >;
  };

  /** Stronicowana lista sesji usera z flagą is_current (bez tokenu i userId). */
  SESSION_GET_ALL: {
    REQUEST: { cursor?: string; take?: number } | undefined;
    RESPONSE: {
      sessions: (Omit<Session, 'userId' | 'token'> & { is_current: boolean })[];
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_DTO_API_V1['SESSION_GET_ALL']['REQUEST'],
      SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE'],
      SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE_ERROR']
    >;
  };

  /** Zwraca bieżącego zalogowanego usera z bezpieczną sesją bez tokenu, albo undefined gdy brak. */
  SESSION_GET_CURRENT: {
    REQUEST: Record<string, never>;
    RESPONSE: SafeCurrentUser | undefined;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SESSION_DTO_API_V1['SESSION_GET_CURRENT']['REQUEST'],
      SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE'],
      SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE_ERROR']
    >;
  };
};
