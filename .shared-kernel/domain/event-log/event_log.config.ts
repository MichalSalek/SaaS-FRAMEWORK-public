import type { EventLogType } from '../../models/db_models.generated.dto';
import { EventLogTypeValue } from '../../models/db_models.generated.dto';
import type { EVENTS_ALL_TYPE } from '../commands-and-queries/cqrs.types';

export const allowedEventLogTypes: Readonly<
  Record<EventLogType, EVENTS_ALL_TYPE[]>
> = {
  [EventLogTypeValue.LOGIN]: [
    'USER_LOGGED_IN',
    'USER_LOGGED_OUT',
    'CANNOT_LOGIN',
    'USER_DISABLED_SELF',
    'CANNOT_DISABLE_ACTIVE_SUBSCRIPTION',
    'ALL_SESSIONS_DELETED',
    'SESSION_EXPIRED',
    'SESSION_DELETED',
    'SESSION_DELETED_EXACTLY',
    // DECISION (nie usuwaj tego komentarza):
    // USER_BECAME_SOMEONE_ELSE / USER_SWITCHED_BACK_TO_SELF są zarejestrowane WYŁĄCZNIE
    // w buckecie ADMIN (poniżej). Usunięto je stąd (dual-bucket → policy
    // GET_EVENT_LOG_TYPE_FOR_EVENT_LOG zwracała PIERWSZY match = LOGIN, sprzeczny z
    // write-sites). Write-sites (admin-impersonation.operations.ts) piszą explicit
    // EventLogTypeValue.ADMIN przez writeRawEventLog_IO; konsumenci filtrują/oceniają po
    // ADMIN (anomaly-alerts.operation.ts `event_type: ADMIN`, AdminAuditPage severity=high).
    // ŻADEN konsument nie polega na LOGIN-buckecie dla tych eventów. Dual-bucket był
    // latent bug: migracja write-site do recordAuditEvent_IO (policy-gated) cicho
    // zaklasyfikowałaby je jako LOGIN. Single-bucket ADMIN = SSOT.
  ],
  [EventLogTypeValue.ACCOUNT]: [
    'PAYMENT_DONE',
    'ACCOUNT_CREATED',
    'DISPLAY_NAME_CHANGED',
    'USER_DISABLED',
    'USER_ENABLED',
    'USER_DELETED',
    'USER_CREATED',
    'USER_REGISTERED',
    'PRICING_PLAN_CHANGED',
    'USER_DATA_EXPORTED',
    'USER_EMAIL_CHANGED',
    'USER_DELETED_SELF',
    // ADRR Model A (§13.1) account lifecycle audit. Without registration here the
    // policy gate silently DROPS these from the audit log (production audit hole).
    // Write sites:
    //  • ACCOUNT_SOFT_DELETED → confirmDeleteSelf_IO dedicated recordAuditEvent_IO on the
    //    soft-delete mutation (independent of the recovery email — see DECISION in that op;
    //    the email carries its own EMAIL_ACCOUNT_DELETION_RECOVERY_SENT fact)
    //  • ACCOUNT_REACTIVATED / ACCOUNT_REACTIVATION_FAILED → user/reactivate handler
    //  • ACCOUNT_GDPR_ERASED → user/gdpr-erase handler (Art. 17, logged pre-delete)
    //  • RECOVERY_EXPIRED → B2 recovery-expiry cron interceptor (flips recovery_available=false)
    'ACCOUNT_SOFT_DELETED',
    'ACCOUNT_REACTIVATED',
    'ACCOUNT_REACTIVATION_FAILED',
    'ACCOUNT_GDPR_ERASED',
    'RECOVERY_EXPIRED',
    // USER_ACCOUNT_MOVED_TO_ARCHIVE → recovery-expiry interceptor (90d MOVE)
    'USER_ACCOUNT_MOVED_TO_ARCHIVE',
    'VANITY_URL_SET',
    'BRAND_ACCENT_SET',
    // Avatar stylistki (2026-09-09) — write site: handler account/set-avatar
    // (recordAuditEvent_IO). Bez rejestracji tutaj bramka polityki cicho
    // porzuca wpis, a zmiana twarzy publicznego profilu nie zostawia śladu.
    'AVATAR_SET',
    'AVATAR_CLEARED',
    // D5 (run 25 TRD): per-section audit events emitted by the atomic UPDATE_STYLIST_PROFILE op
    'ACCOUNT_LOCATION_SET',
    'STYLIST_SOCIAL_LINKS_UPDATED',
    // D5 wrapper event: emitted once per successful atomic mutation
    'STYLIST_PROFILE_UPDATED',
    // DECISION (nie usuwaj tego komentarza):
    // ADMIN_PRICING_PLAN_CHANGED is written with EventLogTypeValue.ACCOUNT in
    // plan-status-update.operations.ts (write site = source of truth). The event
    // originates from Stripe webhook lifecycle, not admin panel — it tracks per-account
    // plan transitions. Registered here (ACCOUNT) to match write site, not ADMIN category.
    'ADMIN_PRICING_PLAN_CHANGED',
    // Stripe webhook handlers write these via writeRawEventLog_IO (bypass policy gate).
    // Registered here so the allowedEventLogTypes policy gate recognises them if it ever
    // becomes the write path, and for UI display / admin queries filtering by ACCOUNT type.
    'STRIPE_INVOICE_PAYMENT_SUCCEEDED',
    'STRIPE_INVOICE_PAYMENT_FAILED',
    'STRIPE_INVOICE_UPCOMING',
    'STRIPE_TRIAL_WILL_END',
    'STRIPE_CHARGE_DISPUTE_CREATED',
    'STRIPE_CHARGE_DISPUTE_CLOSED',
    'STRIPE_SUBSCRIPTION_PENDING_UPDATE_DETECTED',
    'STRIPE_SUBSCRIPTION_SCHEDULE_DETECTED',
    'STRIPE_EMAIL_SYNC_FAILED',
    // Salon staff mutations — audit trail for invite/remove/permission changes
    // Registered under ACCOUNT (not ADMIN) because actor is the stylist account
    // owner managing their own staff roster, not a system admin.
    'SALON_STAFF_INVITED',
    'SALON_STAFF_REMOVED',
    'SALON_STAFF_PERMISSIONS_UPDATED',
    // Invitee's answer (2026-09-25), write site: salon/invitations/respond handler
    // (recordAuditEvent_IO). The actor is the invited stylist acting on her own
    // membership, so ACCOUNT like the owner-side siblings above.
    'SALON_STAFF_INVITATION_ACCEPTED',
    'SALON_STAFF_INVITATION_DECLINED',
    // DD-BE (Fix Wave): self-service account-lifecycle audit events emitted via
    // recordAuditEvent_IO. Without registration here the policy gate
    // (GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG + GET_EVENT_LOG_TYPE_FOR_EVENT_LOG)
    // returns false/undefined and the audit write is a silent no-op (production
    // audit hole). All actors are the account owner acting on their own account →
    // ACCOUNT category. Write sites:
    //  • NOTIFICATION_PREFERENCES_UPDATED → user/update-notification-preferences handler
    //  • USER_NAME_CHANGED → user/change-name handler
    //  • DASHBOARD_NOTE_SET → account/set-dashboard-note handler
    //  • TRIAL_STARTED → handleTrialFieldsUpdate (stripe/webhooks subscription-update.utils),
    //    emitted EXACTLY ONCE when trial_started_at transitions NULL→set on the first
    //    customer.subscription.created/updated 'trialing' event (SPE trial-start path;
    //    count-gated so retries / fan-in duplicates do not re-log).
    'NOTIFICATION_PREFERENCES_UPDATED',
    'USER_NAME_CHANGED',
    'DASHBOARD_NOTE_SET',
    //  • GALLERY_STRENGTH_DISMISSED → account/dismiss-gallery-strength handler
    'GALLERY_STRENGTH_DISMISSED',
    'TRIAL_STARTED',
    // SPE plan-selection audit (event-log registration gap): both emitted via
    // recordAuditEvent_IO from the ACCOUNT_CHECKOUT_SESSION handler (createCheckoutSession_IO).
    // Without registration here the policy gate returns false and the audit write is a silent
    // no-op (production audit hole → plan-selection writes no audit row). Actor is the stylist
    // acting on their own account → ACCOUNT category. Write sites:
    //  • CHECKOUT_FREE_SELECTED → free-plan branch (plan_selected_at set, ZERO Stripe)
    //  • CHECKOUT_SESSION_CREATED → paid branch (embedded/hosted checkout session created)
    'CHECKOUT_FREE_SELECTED',
    'CHECKOUT_SESSION_CREATED',
    // Faktura VAT: dane firmowe zapisane na Stripe Customer (audit; stylistka na
    // własnym koncie → ACCOUNT). Emitowane via recordAuditEvent_IO z handlera
    // account/vat-invoice-details — bez rejestracji tu gate zwróciłby false (silent no-op).
    'VAT_INVOICE_DETAILS_SAVED',
    // Recurring-class fix (event-log registration gap): emitted via recordAuditEvent_IO
    // from account-lifecycle handlers. Without registration here the policy gate
    // (GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG) returns false and the audit write is a
    // silent no-op (production audit hole). All actors are the account owner acting on
    // their own account → ACCOUNT category (matches USER_*/ACCOUNT_REACTIVATED siblings).
    // Write sites:
    //  • ACCOUNT_RECOVERED / ACCOUNT_RECOVERY_FAILED → user/restore-account handler (ADRR recovery)
    //  • CLIENT_ACCOUNT_CREATED → user/onboard-client handler
    //  • STYLIST_ACCOUNT_CREATED → user/onboard-stylist handler
    //  • STRIPE_PORTAL_SESSION_CREATED → stripe/portal handler (billing-portal session opened)
    //  • USER_DELETE_REQUESTED / USER_DELETE_CONFIRMED → user/delete/self + user/delete/confirm
    //  • USER_EMAIL_CHANGE_REQUESTED / USER_EMAIL_CHANGE_CONFIRMED → user/change-email + user/confirm-email-change
    'ACCOUNT_RECOVERED',
    'ACCOUNT_RECOVERY_FAILED',
    'CLIENT_ACCOUNT_CREATED',
    'STYLIST_ACCOUNT_CREATED',
    'STRIPE_PORTAL_SESSION_CREATED',
    'USER_DELETE_REQUESTED',
    'USER_DELETE_CONFIRMED',
    'USER_EMAIL_CHANGE_REQUESTED',
    'USER_EMAIL_CHANGE_CONFIRMED',
    // Recurring-class fix (event-log registration gap): emitted via recordAuditEvent_IO
    // from self-service mutation handlers. Without registration here the policy gate
    // (GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG + GET_EVENT_LOG_TYPE_FOR_EVENT_LOG)
    // returns false/undefined and the audit write is a silent no-op (production audit
    // hole). Both actors are the account owner acting on their own account → ACCOUNT
    // category (mirrors DASHBOARD_NOTE_SET / USER_NAME_CHANGED siblings). Write sites:
    //  • CLIENT_CONTACT_UPDATED → client/update-contact handler (PII mutation: contact_phone/email)
    //  • USER_ROLE_SWITCHED → user/switch-role handler (RBAC role_id + account_type transition)
    'CLIENT_CONTACT_UPDATED',
    'USER_ROLE_SWITCHED',
  ],
  [EventLogTypeValue.GALLERY]: [
    'GALLERY_RECORD_CREATED',
    'GALLERY_RECORD_UPDATED',
    'GALLERY_RECORD_DELETED',
    'GALLERY_RECORD_PINNED',
    'GALLERY_RECORD_UNPINNED',
    'FAVORITE_RECORD_ADDED',
    'RECORD_REMOVED_FROM_FAVORITES',
    'STYLIST_BOOKMARKED',
    'STYLIST_UNBOOKMARKED',
    'ASSET_DELETED_FROM_VENDOR',
    'FAVORITE_RECORD_NOTE_UPDATED',
    // Recurring-class fix (event-log registration gap): emitted via recordAuditEvent_IO
    // from gallery/favorite handlers on the no-op/guard branch. Without registration the
    // policy gate silently DROPS the audit write. Categorized GALLERY to match sibling
    // gallery/favorite/bookmark events (FAVORITE_* and STYLIST_*BOOKMARKED live here).
    // Write sites:
    //  • STYLIST_NOT_BOOKMARKED → bookmark/unbookmark-stylist (idempotent no-op branch)
    //  • RECORD_NOT_IN_FAVORITES → favorite/remove-record (idempotent no-op branch)
    //  • CANNOT_CREATE_GALLERY_RECORD → gallery/create-gallery-record (plan-limit reject branch)
    'STYLIST_NOT_BOOKMARKED',
    'RECORD_NOT_IN_FAVORITES',
    'CANNOT_CREATE_GALLERY_RECORD',
  ],
  [EventLogTypeValue.ADMIN]: [
    'DEBUG_MODE_ENABLED',
    'DEBUG_MODE_DISABLED',
    'DEBUG_DB_MODE_ENABLED',
    'DEBUG_DB_MODE_DISABLED',
    'USER_BECAME_SOMEONE_ELSE',
    'USER_SWITCHED_BACK_TO_SELF',
    // Refresh prolongs a live impersonation; written by adminRefreshImpersonation_IO
    // via writeRawEventLog_IO with explicit ADMIN, next to its two siblings above.
    'IMPERSONATION_REFRESHED',
    'NOTE_SET',
    'REPORT_RESOLVED',
    'STRIKE_APPLIED',
    // D4 — Admin config audit (SOC2 compliance: who/what/when/before/after)
    'FEATURE_FLAG_TOGGLED',
    'POLICY_SAVED',
    'POLICY_DELETED',
    'POLICY_SET_MAIN',
    'CONFIG_UPDATED',
    'ADMIN_PERMISSIONS_UPDATED',
    // PLQS Wave 4D — impersonation sensitive mutation gate (BLOCK + override audit trail)
    'IMPERSONATION_SENSITIVE_BLOCKED',
    'IMPERSONATION_SENSITIVE_OVERRIDE',
    // DD-BE (Fix Wave): admin bulk actions write via writeRawEventLog_IO direct with
    // eventLogType ADMIN (bypass the policy gate). Registered here so the
    // allowedEventLogTypes policy is ACCURATE — downstream consumers filtering by the
    // ADMIN allowlist (admin queries / UI display) would otherwise drop these writes,
    // and a future migration to recordAuditEvent_IO would silently no-op. Adding to the
    // list does not change current write behaviour (these are already persisted).
    'BULK_DISABLE_SUCCESS',
    'BULK_ENABLE_SUCCESS',
    'BULK_CHANGE_PLAN_SUCCESS',
    'BULK_LOGOUT_SUCCESS',
    // Global taxonomy audit (R3). admin-colors-traits.operations.ts mutations write via
    // writeRawEventLog_IO direct with eventLogType ADMIN. Without registration here the
    // allowedEventLogTypes policy is INACCURATE — downstream consumers filtering by the
    // ADMIN allowlist (admin queries / audit-trail UI) would drop these writes, and a
    // future migration to recordAuditEvent_IO (policy-gated) would silently no-op.
    // These are global color/trait records selected by ALL stylists → ADMIN category
    // (mirrors sibling admin config mutations FEATURE_FLAG_TOGGLED / CONFIG_UPDATED).
    'COLOR_CREATED',
    'COLOR_UPDATED',
    'COLOR_DELETED',
    'TRAIT_CREATED',
    'TRAIT_UPDATED',
    'TRAIT_DELETED',
    // Triage logów: nadanie grupie błędów statusu (znany / naprawiony / ignorowany).
    // To decyzja operacyjna admina o stanie produkcji, więc zostawia ślad w audycie
    // na równi z przełączeniem feature-flagi czy zmianą configu.
    'LOG_ISSUE_STATUS_SET',
  ],
  [EventLogTypeValue.DOMAIN]: [
    'PAIRING_SESSION_ISSUED',
    'PAIRING_SESSION_CLAIMED',
    'PAIRING_SESSION_REVOKED',
    'PAIRING_ACCESS_REVOKED',
    // Stały kod QR (2026-07-11): lejek prośby o połączenie z profilu —
    // rejestracja W TYM buckecie jest warunkiem zapisu (recordAuditEvent_IO
    // bez rejestracji = silent no-op).
    'PAIR_REQUEST_SENT',
    'PAIR_REQUEST_ACCEPTED',
    'PAIR_REQUEST_DECLINED',
    'PAIR_REQUEST_CANCELLED',
    // Messaging (komunikator stylistka↔klientka, 2026-07-16): interakcje domenowe
    // w ramach pary — kategoria DOMAIN jak siblingi PAIRING_*/SESSION_CONTAINER_*.
    'MESSAGING_MESSAGE_SENT',
    'MESSAGING_MARKED_READ',
    'MESSAGING_THREAD_FETCHED',
    'MESSAGING_CONVERSATIONS_FETCHED',
    'MESSAGING_NOT_ALLOWED',
    'MESSAGING_PAIR_NOT_FOUND',
    // Ukrycie rozmowy (decyzja ownera D2, 2026-09-05): wyciszenie po stronie
    // jednego uczestnika, emitowane przez recordAuditEvent_IO z messaging/hide i unhide.
    'MESSAGING_CONVERSATION_HIDDEN',
    'MESSAGING_CONVERSATION_UNHIDDEN',
    'CONTENT_REPORTED',
    // DD-BE (Fix Wave): emitted via recordAuditEvent_IO from support/create-thread.
    // Without registration the policy gate silently drops the audit write (no-op).
    // Categorized DOMAIN (not ACCOUNT) to match sibling domain-interaction events
    // (PAIRING_*, CONTENT_REPORTED): a support thread is a domain interaction record,
    // not an account-lifecycle mutation.
    'SUPPORT_THREAD_CREATED',
    // Recurring-class fix (event-log registration gap): emitted via recordAuditEvent_IO.
    // Without registration the policy gate silently DROPS the audit write (no-op).
    // Categorized DOMAIN to match sibling domain-interaction events (PAIRING_*, SUPPORT_THREAD_CREATED):
    // support replies/status and session-containers are client↔stylist domain interactions,
    // not account-lifecycle mutations. Write sites:
    //  • SUPPORT_MESSAGE_SENT → support/add-message handler
    //  • SUPPORT_ADMIN_REPLIED → admin/support/reply handler
    //  • SUPPORT_STATUS_CHANGED → admin/support/change-status handler
    //  • ALL_PAIRING_SESSIONS_REVOKED → pairing/revoke-all-sessions handler
    //  • SESSION_CONTAINER_* → session-container/* handlers (client↔stylist session records)
    'SUPPORT_MESSAGE_SENT',
    'SUPPORT_ADMIN_REPLIED',
    'SUPPORT_STATUS_CHANGED',
    'ALL_PAIRING_SESSIONS_REVOKED',
    'SESSION_CONTAINER_CREATED',
    'SESSION_CONTAINER_CLOSED',
    'SESSION_CONTAINER_SHARED',
    'SESSION_CONTAINER_PHOTO_ADDED',
    'SESSION_CONTAINER_NOTE_UPDATED',
    'SESSION_CONTAINER_FETCHED',
    'SESSION_CONTAINERS_FETCHED',
    // Client-card CRM events are stylist↔client domain interactions, not account
    // lifecycle changes. They are emitted via recordAuditEvent_IO from visit/CRM
    // handlers; registration here keeps the policy gate from silently dropping
    // relationship-history audit writes.
    'CLIENT_CRM_NOTE_UPSERTED',
    'CLIENT_CRM_NOTE_DELETED',
    'VISIT_CREATED',
    'VISIT_NOTE_UPDATED',
    'VISIT_RESULT_PHOTO_ADDED',
    'VISIT_RESULT_PHOTO_REMOVED',
    'VISIT_DELETED',
    // I8 (Fix Wave): NEWSLETTER_PENDING_CONFIRMATION jest przekazywany jako `infoEvent`
    // do sendTransactionalEmail → recordAuditEvent_IO({ eventName: infoEvent }) w
    // newsletter-subscribe.operations.ts. Bez rejestracji tutaj policy gate
    // (GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG) zwraca false i audit write jest cichym
    // no-opem (observability hole — event-log-registration.sh tego NIE łapie, bo eventName
    // jest dynamiczny). Kategoria DOMAIN: newsletter to interakcja domenowa (mirror
    // PAIRING_* / CONTENT_REPORTED), nie mutacja account-lifecycle. Rejestracja jest
    // self-contained w kernelu — i18n key 'NEWSLETTER_PENDING_CONFIRMATION' już istnieje we
    // wszystkich locale (event dociera też do UI via respondSuccess), więc ZERO zmian w
    // main/src/locales/. UWAGA: większość subskrybentów jest anonimowa (bez user) → guard
    // created_by_user_id i tak pominie row, ale zarejestrowanie domyka policy-gate dla
    // zalogowanych subskrybentów i czyni allowedEventLogTypes accurate.
    'NEWSLETTER_PENDING_CONFIRMATION',
  ],
  [EventLogTypeValue.EMAIL]: [
    'EMAIL_WELCOME_SENT',
    'EMAIL_TRIAL_D1_NUDGE_SENT',
    'EMAIL_TRIAL_D3_INACTIVE_SENT',
    'EMAIL_TRIAL_D3_ACTIVE_SENT',
    'EMAIL_TRIAL_D7_ACTIVE_SENT',
    'EMAIL_TRIAL_D7_INACTIVE_SENT',
    'EMAIL_TRIAL_D14_ACTIVE_SENT',
    'EMAIL_TRIAL_D14_INACTIVE_SENT',
    'EMAIL_TRIAL_D23_WARNING_SENT',
    'EMAIL_TRIAL_D29_LAST_DAY_SENT',
    'EMAIL_TRIAL_D30_ENDED_SENT',
    'EMAIL_TRIAL_D37_WINBACK_SENT',
    'EMAIL_UPGRADE_CONFIRMATION_SENT',
    'EMAIL_DOWNGRADE_NOTIFICATION_SENT',
    'EMAIL_PAIRING_NOTIFICATION_SENT',
    // Email-change transactional sends (recordAuditEvent_IO via sendTransactionalEmail
    // infoEvent in user-email-change.operations.ts). Without registration here the policy
    // gate silently DROPS the audit write (production audit hole). EMAIL category, mirroring
    // sibling transactional send facts (EMAIL_PAIRING_NOTIFICATION_SENT / EMAIL_UPGRADE_CONFIRMATION_SENT).
    //  • EMAIL_CHANGE_CONFIRM_SENT → confirmation mail to the NEW address
    //  • EMAIL_CHANGE_NOTIFY_SENT  → security-notify mail to the OLD/current address
    'EMAIL_CHANGE_CONFIRM_SENT',
    'EMAIL_CHANGE_NOTIFY_SENT',
    // EMAIL_ACCOUNT_DELETION_RECOVERY_SENT → recovery-notice mail after self soft-delete
    // (recordAuditEvent_IO via sendTransactionalEmail infoEvent in confirmDeleteSelf_IO).
    // Without registration here the policy gate silently DROPS the audit write. This is
    // the "email-sent" fact — the ACCOUNT_SOFT_DELETED lifecycle row is written separately
    // on the mutation (allowedEventLogTypes[ACCOUNT]), independent of email success.
    'EMAIL_ACCOUNT_DELETION_RECOVERY_SENT',
    // EMAIL_ACCOUNT_DELETE_CONFIRM_SENT → confirmation-request mail (self-delete link).
    // Without registration here the policy gate silently DROPS the audit write. The
    // USER_DELETE_REQUESTED lifecycle row is recorded separately via runAfterResponse.
    'EMAIL_ACCOUNT_DELETE_CONFIRM_SENT',
    'EMAIL_PAIR_REQUEST_NOTIFICATION_SENT',
    'EMAIL_SESSION_SHARED_NOTIFICATION_SENT',
    'EMAIL_MESSAGING_NOTIFICATION_SENT',
    // Salon-team invitation mail to the invitee (salon-staff-invite-notification.service).
    'EMAIL_SALON_STAFF_INVITATION_SENT',
    'EMAIL_PAYMENT_FAILED_SENT',
    'EMAIL_CANCEL_D1_SENT',
    'EMAIL_CANCEL_D7_WINBACK_SENT',
    'EMAIL_CANCEL_D30_FINAL_SENT',
    'EMAIL_UNSUBSCRIBE_SUCCESS',
    'EMAIL_PREFERENCES_UPDATED',
    'EMAIL_SWEEP_COMPLETED',
    'EMAIL_SEND_FAILED',
    'EMAIL_DEAD_LETTERED',
    'EMAIL_DUNNING_D1_INFO_SENT',
    'EMAIL_DUNNING_D7_URGENT_SENT',
    'EMAIL_DUNNING_D14_FINAL_SENT',
    'EMAIL_DUNNING_AUTO_DOWNGRADE',
    'EMAIL_ADMIN_SIGNUP_DIGEST_SENT',
    'EMAIL_ADMIN_CHURN_ALERT_SENT',
    'EMAIL_ADMIN_DOWNGRADE_ALERT_SENT',
    'ALERT_PAIRING_ANOMALY_SENT',
    'ALERT_UPLOAD_ERROR_RATE_SENT',
    // DD-H1 (Fix Wave A): emitted via recordAuditEvent_IO from operations/circuit-breaker
    // — without registration here the policy gate silently DROPS the event from the
    // audit log (production audit hole). Operation references:
    //  • EMAIL_ONBOARDING_INCOMPLETE_24H_SENT → onboarding-abandonment.operation.ts:187
    //  • EMAIL_RENEWAL_REMINDER_7D_SENT → renewal-reminder.operation.ts:223
    //  • EMAIL_CIRCUIT_BREAKER_OPEN/WARNING/BLOCKED → email-circuit-breaker.ts
    //  • ALERT_IMPERSONATION_VOLUME_SENT → anomaly-alerts.operation.ts:311
    //  • ALERT_IMPERSONATION_OFF_HOURS_SENT → anomaly-alerts.operation.ts:401
    'EMAIL_ONBOARDING_INCOMPLETE_24H_SENT',
    'EMAIL_RENEWAL_REMINDER_7D_SENT',
    // EMAIL_WINBACK_DELETION_D60_SENT → win-back po usunięciu konta (sender deferred post-launch)
    'EMAIL_WINBACK_DELETION_D60_SENT',
    'EMAIL_CIRCUIT_BREAKER_OPEN',
    'EMAIL_CIRCUIT_BREAKER_WARNING',
    'EMAIL_CIRCUIT_BREAKER_BLOCKED',
    'ALERT_IMPERSONATION_VOLUME_SENT',
    'ALERT_IMPERSONATION_OFF_HOURS_SENT',
  ],
} as const;

export const allowedEventLogTypesValues =
  Object.values(allowedEventLogTypes).flat();

export const allowedEventLogTypesValuesSet: ReadonlySet<EVENTS_ALL_TYPE> =
  new Set(allowedEventLogTypesValues);

export const allowedEventLogTypeSets = Object.fromEntries(
  Object.entries(allowedEventLogTypes).map(([key, values]) => [
    key,
    new Set(values),
  ])
) as unknown as Readonly<Record<EventLogType, ReadonlySet<EVENTS_ALL_TYPE>>>;

// DECISION (nie usuwaj tego komentarza):
// USER_FACING_ACTIVITY_EVENTS = whitelist eventów, które user ROZUMIE na ekranie
// „Aktywność" (endpoint event-log/get-all filtruje po niej server-side).
// Techniczne / webhook / lifecycle eventy (STRIPE_*, EMAIL_*, RECOVERY_EXPIRED,
// USER_ROLE_SWITCHED, SALON_STAFF_*, ...) ZOSTAJĄ w EventLog jako audit trail —
// po prostu nie idą do user-facing listy (bez whitelisty renderowały się jako
// spam „Aktywność na koncie" przez FALLBACK_SPEC). Zawartość = 1:1 z EVENT_MAP
// frontendu (main/src/UI/features/account/UserActivityPage.events-map.tsx) dla
// bucketów LOGIN + ACCOUNT; parity pilnuje co-located test przy events-map.
// DEV_LOGIN_SUCCESS nie jest zarejestrowany w allowedEventLogTypes (write-site
// dev-login pisze writeRawEventLog_IO z explicit LOGIN, poza policy gate), ale
// przychodzi w fetchu LOGIN → musi być na whiteliście.
export const USER_FACING_ACTIVITY_EVENTS: readonly EVENTS_ALL_TYPE[] =
  Object.freeze([
    // LOGIN bucket
    'USER_LOGGED_IN',
    'DEV_LOGIN_SUCCESS',
    'USER_LOGGED_OUT',
    'CANNOT_LOGIN',
    'SESSION_EXPIRED',
    'SESSION_DELETED',
    'SESSION_DELETED_EXACTLY',
    'ALL_SESSIONS_DELETED',
    // ACCOUNT bucket
    'USER_CREATED',
    'USER_REGISTERED',
    'ACCOUNT_CREATED',
    // DECISION (nie usuwaj tego komentarza):
    // Legacy USER_DELETED_SELF / USER_EMAIL_CHANGED USUNIĘTE z whitelisty
    // (zero write-sites w web-1 — martwe nazwy; realne zdarzenia audytowe to
    // ACCOUNT_SOFT_DELETED oraz USER_EMAIL_CHANGE_REQUESTED/_CONFIRMED, wszystkie
    // pisane przez recordAuditEvent_IO i zarejestrowane w allowedEventLogTypes[ACCOUNT]).
    // Efekt: bezpieczeństwowo-wrażliwa zmiana e-maila oraz soft-delete konta
    // pojawiają się teraz na user-facing „Aktywności" (wcześniej znikały).
    'ACCOUNT_SOFT_DELETED',
    'USER_NAME_CHANGED',
    'USER_EMAIL_CHANGE_REQUESTED',
    'USER_EMAIL_CHANGE_CONFIRMED',
    'DISPLAY_NAME_CHANGED',
    'PRICING_PLAN_CHANGED',
    'PAYMENT_DONE',
    'ACCOUNT_LOCATION_SET',
    'VANITY_URL_SET',
    'USER_DATA_EXPORTED',
  ]);
