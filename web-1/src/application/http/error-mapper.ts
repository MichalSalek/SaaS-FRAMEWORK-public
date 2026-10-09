// Central error-to-HTTP mapper — exhaustive switch on domain error types
// SSOT: All domain errors map to correct respond* + APP_EVENTS.INFO.* events (C6 correction)

import type { NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// Domain error types
import type { GalleryError } from '@kernel/domain/gallery/gallery-errors.types';
import type { PairingError } from '@kernel/domain/pairing/pairing-errors.types';
import type { FavoriteError } from '@kernel/domain/favorites/favorite-errors.types';
import type { UserError } from '@kernel/domain/user-and-account/user-errors.types';
import type { AccountError } from '@kernel/domain/user-and-account/account-errors.types';
import type { AdminError } from '@kernel/domain/admin/admin-errors.types';
import type { SessionContainerError } from '@kernel/domain/session-container/session-container-errors.types';
import type { ClientError } from '@kernel/domain/client/client-errors.types';
import type { VisitError } from '@kernel/domain/visit/visit-errors.types';
import type { SalonStaffError } from '@kernel/domain/salon-staff/salon-staff-errors.types';
import type { EmailError } from '@kernel/domain/email/email-errors.types';
import type { ModerationError } from '@kernel/domain/moderation/moderation-errors.types';
import type { NewsletterError } from '@kernel/domain/newsletter/newsletter-errors.types';
import type { SupportError } from '@kernel/domain/support/support-errors.types';
import type { ContactError } from '@kernel/domain/contact/contact-errors.types';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import type { CommonError } from '@kernel/application/common-errors.types';

// Response helpers
import {
  respondAccountNotFound,
  respondBadRequest,
  respondConflict,
  respondDomainRateLimited,
  respondForbidden,
  respondGeneralError,
  respondNotFound,
  respondPlanLimitReached,
  respondQueryFailure,
  respondStaffAlreadyExists,
  respondSuccess,
  respondTooManyRequests,
  respondUnauthorized,
  respondUserNotFound,
  respondValidationFailed,
} from './http.responses.utils';
import { reportIssueBackend } from '@app/debugger/error-handler';

// DECISION (nie usuwaj tego komentarza) — KAŻDA DOMENA WCHODZI TU PRZEZ SWOJĄ UNIĘ,
// NIGDY PRZEZ WYLICZENIE POJEDYNCZYCH CZŁONÓW:
// newsletter był jedynym wyjątkiem — importował cztery osobne typy błędów zamiast
// `NewsletterError`. Skutek był cichy i groźny: dopisanie piątego wariantu do
// `NewsletterError` w jądrze NIE poszerzało `DomainError`, więc `const _exhaustive:
// never` w gałęzi `default` dalej się kompilował (nowy wariant po prostu nie istniał
// dla tego switcha). Gwarancja kompletności, po którą ten mapper istnieje, milczała,
// a nowy błąd domenowy lądował w `default` → nieprzezroczyste 500 zamiast właściwego
// statusu i eventu. Union-import odwraca to: nowy członek unii = natychmiastowy błąd
// kompilacji w tym pliku, czyli dokładnie ten sygnał, który ma tu działać.
// NIE „upraszczać" z powrotem do listy pojedynczych typów.
export type DomainError =
  | CommonError
  | GalleryError
  | PairingError
  | FavoriteError
  | UserError
  | AccountError
  | AdminError
  | SessionContainerError
  | ClientError
  | VisitError
  | SalonStaffError
  | EmailError
  | ModerationError
  | NewsletterError
  | SupportError
  | ContactError
  | MessagingError;

// DECISION (nie usuwaj tego komentarza):
// Monolityczny exhaustive switch jest CELOWY i NIE wolno go dzielic na mniejsze
// per-domena mappery. Gwarancja kompletnosci opiera sie na `const _exhaustive: never`
// w gałęzi default — TypeScript wymusza obsluge KAZDEGO wariantu unii DomainError
// tylko wtedy, gdy switch widzi PELNA unie naraz. Split (np. mapAdminError +
// mapGalleryError) rozbilby te gwarancje: kazdy pod-switch zawezalby typ, a brakujacy
// case w jednym z nich przeszedlby kompilacje bez bledu (silent fall-through do
// generic 500). Dlatego eslint max-lines override na tym pliku jest swiadomy —
// dlugosc to akceptowany koszt statycznej kompletnosci mapowania bledow.
export function mapErrorToResponse(
  res: NextApiResponse,
  error: DomainError
): void {
  switch (error.type) {
    // ── Common errors ──
    case 'ACCOUNT_NOT_FOUND':
      return respondAccountNotFound(res, { accountId: error.accountId });

    case 'UNAUTHORIZED':
      // DECISION (nie usuwaj tego komentarza): MISSING_PERMISSION i
      // WRONG_ACCOUNT_TYPE dotyczą ZALOGOWANEGO usera (token rozpoznany, brak
      // roli/uprawnienia) → 403, jak w request.middleware. 401 zostaje dla
      // „nie rozpoznano poświadczeń". Wcześniej szło 401 + UNAUTHORIZED, a front
      // traktował każde 401 jak martwy token i wylogowywał (admin klikający
      // „Polubione" w szufladzie, S122). Event bez zmian: UNAUTHORIZED.
      if (error.reason === 'MISSING_PERMISSION') {
        return respondForbidden(
          res,
          {
            reason: error.reason,
            requiredPermission: error.requiredPermission,
          },
          APP_EVENTS.INFO.USER.UNAUTHORIZED
        );
      } else if (error.reason === 'WRONG_ACCOUNT_TYPE') {
        return respondForbidden(
          res,
          {
            reason: error.reason,
            requiredAccountType: error.requiredAccountType,
          },
          APP_EVENTS.INFO.USER.UNAUTHORIZED
        );
      } else if (error.reason === 'ACCOUNT_INACTIVE') {
        return respondForbidden(res, {
          reason: error.reason,
        });
      } else {
        return respondUnauthorized(res, { reason: error.reason });
      }

    case 'VALIDATION_ERROR':
      return respondValidationFailed(res, {
        field: error.field,
        message: error.message,
      });

    case 'DATABASE_ERROR':
    case 'EXTERNAL_SERVICE_ERROR':
      // F14 dedup: both are logged server-side at the source (databaseFailure /
      // externalServiceFailure capture operation + cause). The client gets an
      // opaque 500 — never the function name, service name or underlying cause
      // (info leak). Shared case keeps that contract identical for both. The one
      // refinement: a request-attributable DB failure (DatabaseError.reason, see
      // classifyQueryFailure) is not a server fault → 409/400, still payload-free.
      if (error.type === 'DATABASE_ERROR' && error.reason !== undefined) {
        return respondQueryFailure(res, error.reason);
      }
      return respondGeneralError(res, undefined);

    case 'SERIALIZATION_CONFLICT':
      // admin-impersonation-1: a transient Postgres 40001 (Serializable txn abort,
      // isSerializationConflict) is a write-write race, NOT a server fault — surface it
      // as 429 "back off and retry", consistent with the other retryable 429 paths
      // (PAIRING_TOO_MANY_ACTIVE_SESSIONS / EXPORT_RATE_LIMITED / CONTENT_REPORT_RATE_LIMITED).
      // Reuses the generic RATE_LIMIT_EXCEEDED_INFO event (already i18n-covered in all
      // locales + event-log descriptions; no new event, no parity work). No payload — the
      // conflict carries no client-safe detail.
      return respondTooManyRequests(
        res,
        APP_EVENTS.INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
        undefined
      );

    case 'CAPTCHA_VERIFICATION_FAILED':
      // 403 — anti-bot (Turnstile) failed: missing token, negative CF verdict, or
      // fail-closed infra error (turnstile.verify.ts DECISION). SECURITY: error.reason
      // (CF codes / 'missing-token' / 'siteverify-*') is deliberately NOT echoed —
      // it would coach a bot on which bypass got furthest; infra fails are reported
      // at the source.
      return respondForbidden(
        res,
        undefined,
        APP_EVENTS.INFO.PUBLIC.CAPTCHA_VERIFICATION_FAILED
      );

    case 'STYLIST_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
        stylistAccountId: error.stylistAccountId,
      });

    case 'ANNOUNCEMENT_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
        announcementId: error.announcementId,
      });

    // ── Gallery errors ──
    case 'GALLERY_RECORD_NOT_FOUND':
      return respondNotFound(
        res,
        APP_EVENTS.INFO.GALLERY.CANNOT_GET_GALLERY_RECORD,
        { recordId: error.recordId }
      );

    // F-merge: GALLERY / PAIRING / SALON_STAFF limit-reached all carry the identical
    // { currentCount, limit, planType } shape and map to the same respondPlanLimitReached
    // (HTTP 403 plan-limit, no event arg). Shared fall-through keeps the response
    // byte-identical for all three; the discriminant is consumed via union narrowing.
    case 'GALLERY_LIMIT_REACHED':
    case 'PAIRING_LIMIT_REACHED':
    case 'SALON_STAFF_LIMIT_REACHED':
      return respondPlanLimitReached(res, {
        currentCount: error.currentCount,
        limit: error.limit,
        planType: error.planType,
      });

    case 'GALLERY_RECORD_OWNERSHIP_ERROR':
      return respondForbidden(res, {
        recordId: error.recordId,
      });

    case 'GALLERY_PIN_LIMIT_REACHED':
      return respondForbidden(
        res,
        { currentPinned: error.currentPinned, limit: error.limit },
        APP_EVENTS.INFO.GALLERY.GALLERY_PIN_LIMIT_REACHED
      );

    case 'GALLERY_RECORD_ALREADY_PINNED':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_ALREADY_PINNED,
        { recordId: error.recordId }
      );

    case 'GALLERY_RECORD_NOT_PINNED':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_NOT_PINNED,
        { recordId: error.recordId }
      );

    // ── Pairing errors ──
    // Stały kod QR (2026-07-11): anty-oracle 404 — prośba (cudza/nie-PENDING)
    // i cel prośby (nieistniejąca/nieaktywna/własna stylistka) = 1 kształt.
    case 'PAIR_REQUEST_NOT_FOUND':
      return respondNotFound(
        res,
        APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_NOT_FOUND,
        { pairId: error.pairId }
      );
    // D3 (2026-09-05): maska ZOSTAJE (404, jeden kształt dla nieistniejącej /
    // nieaktywnej / własnej stylistki ORAZ zerwania po jej stronie), zmienia się
    // wyłącznie event → neutralny komunikat na froncie („nie udało się wysłać
    // prośby"), który nie ujawnia odmowy i nie zostawia trwałego stanu „wyłączone".
    case 'PAIR_REQUEST_STYLIST_NOT_FOUND':
      return respondNotFound(
        res,
        APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_UNAVAILABLE,
        { stylistAccountId: error.stylistAccountId }
      );
    // Branding-light: edycja koloru akcentu wymaga planu z can_brand_profile.
    case 'BRANDING_PLAN_LOCKED':
      return respondForbidden(res, { accountId: error.accountId });

    case 'PAIRING_SESSION_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.PAIRING.PAIRING_NOT_FOUND, {
        sessionId: error.sessionId,
      });

    // PAIRING_LIMIT_REACHED merged into the shared respondPlanLimitReached
    // fall-through (see GALLERY_LIMIT_REACHED block above).

    case 'PAIRING_CODE_INVALID': {
      const pairingCodeEventMap = {
        NOT_FOUND: APP_EVENTS.INFO.PAIRING.INVALID_PAIRING_TOKEN,
        EXPIRED: APP_EVENTS.INFO.PAIRING.PAIRING_TOKEN_EXPIRED,
        REVOKED: APP_EVENTS.INFO.PAIRING.PAIRING_TOKEN_REVOKED,
        ALREADY_CLAIMED: APP_EVENTS.INFO.PAIRING.PAIRING_TOKEN_ALREADY_CLAIMED,
        STYLIST_INACTIVE: APP_EVENTS.INFO.PAIRING.PAIRING_STYLIST_INACTIVE,
      } as const;
      return respondBadRequest(res, pairingCodeEventMap[error.reason], {
        code: error.code,
        reason: error.reason,
      });
    }

    case 'PAIRING_TOO_MANY_ACTIVE_SESSIONS':
      return respondTooManyRequests(
        res,
        APP_EVENTS.INFO.PAIRING.TOO_MANY_ACTIVE_SESSIONS,
        { currentCount: error.currentCount, limit: error.limit }
      );

    // DECISION (nie usuwaj tego komentarza):
    // PAIRING_ALREADY_PAIRED case removed — claim flow uses upsert (idempotent reactivation),
    // ALREADY_CLAIMED inside PAIRING_CODE_INVALID handles the user-facing case.

    // ── Favorite errors ──
    case 'BOOKMARK_ALREADY_EXISTS':
      // SECURITY: do not echo clientUserId (caller's own session id, no enumeration value)
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.FAVORITE.STYLIST_ALREADY_BOOKMARKED,
        {
          stylistAccountId: error.stylistAccountId,
        }
      );

    case 'RECORD_ALREADY_IN_FAVORITES':
      // SECURITY: do not echo userId (caller's own session id, no enumeration value)
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.FAVORITE.RECORD_ALREADY_IN_FAVORITES,
        { recordId: error.recordId }
      );

    // FAVORITE_LIMIT_REACHED removed — bookmark has no limit, limit is on pairing

    case 'RECORD_NOT_IN_FAVORITES':
      // SECURITY: do not echo userId (caller's own session id, no enumeration value)
      return respondNotFound(
        res,
        APP_EVENTS.INFO.FAVORITE.RECORD_NOT_IN_FAVORITES,
        { recordId: error.recordId }
      );

    case 'RECORD_TO_ADD_NOT_FOUND':
      // favorites-bookmarks-3: add-path not-found/access-deny. Same 404 + IDOR
      // masking as the gallery GET case, but with the FAVORITE ADD event instead
      // of the gallery-GET event (correct domain + verb in the event log).
      return respondNotFound(
        res,
        APP_EVENTS.INFO.FAVORITE.CANNOT_ADD_RECORD_TO_FAVORITES,
        { recordId: error.recordId }
      );

    // ── User errors ──
    case 'USER_NOT_FOUND':
      return respondUserNotFound(res, {});

    case 'USER_EMAIL_ALREADY_IN_USE':
      // SECURITY: Do not echo email back. Reached only on confirm-side P2002 race
      // (confirmEmailChange_IO TOCTOU), NOT an enumeration oracle — request-side
      // enumeration is closed in changeUserEmail_IO (neutral success response).
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.USER.EMAIL_ALREADY_EXISTS,
        undefined
      );

    case 'EXPORT_RATE_LIMITED':
      return respondTooManyRequests(
        res,
        APP_EVENTS.INFO.USER.USER_DATA_EXPORT_RATE_LIMITED,
        {
          lastExportAt: error.lastExportAt,
          nextAvailableAt: error.nextAvailableAt,
        }
      );

    case 'USER_HAS_ACTIVE_SUBSCRIPTION':
      return respondConflict(
        res,
        APP_EVENTS.INFO.USER.CANNOT_DISABLE_ACTIVE_SUBSCRIPTION,
        {
          userId: error.userId,
          subscriptionStatus: error.subscriptionStatus,
        }
      );

    case 'ACCOUNT_NOT_RECOVERABLE':
      // ADRR Model A: reactivate rejected — account not in RECOVERABLE state
      // (expired window / admin-ban / already active). 409 conflict.
      // userId NOT echoed: caller acts on own session id (no enumeration value).
      return respondConflict(
        res,
        APP_EVENTS.INFO.USER.ACCOUNT_REACTIVATION_FAILED,
        undefined
      );

    // ── Account errors ──
    case 'ACCOUNT_VANITY_URL_TAKEN':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ACCOUNT.VANITY_URL_ALREADY_EXISTS,
        { vanityUrl: error.vanityUrl }
      );

    case 'ACCOUNT_VANITY_URL_RESERVED':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ACCOUNT.VANITY_URL_RESERVED,
        { vanityUrl: error.vanityUrl }
      );

    case 'ACCOUNT_TRIAL_ALREADY_USED':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ACCOUNT.TRIAL_ALREADY_USED,
        { accountId: error.accountId }
      );

    case 'ACCOUNT_TRIAL_NOT_ELIGIBLE':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ACCOUNT.TRIAL_NOT_ELIGIBLE,
        { accountId: error.accountId, reason: error.reason }
      );

    // ── SPE (Stripe Plan Choice + Embedded Payments) errors ──
    case 'CHECKOUT_PLAN_NOT_FOUND':
      // 400 — requested plan has no self-serve Stripe checkout (unknown plan,
      // FREE/SCALE, or missing product). planId echoed (safe, non-PII).
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ACCOUNT.CANNOT_MAKE_PAYMENT,
        { planId: error.planId }
      );

    case 'CHECKOUT_FREE_PLAN_CONFLICT':
      // 400 — Free selected while an active PAID subscription exists; downgrade
      // must go through portal/cancel, not the free-select branch.
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ACCOUNT.CANNOT_CHANGE_PRICING_PLAN,
        { accountId: error.accountId }
      );

    case 'PLAN_CHANGE_NO_SUBSCRIPTION':
      // 400 — paid->paid plan change requires an existing subscription.
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ACCOUNT.CANNOT_CHANGE_PRICING_PLAN,
        { accountId: error.accountId }
      );

    case 'CHECKOUT_CUSTOMER_NOT_READY':
      // 409 — konto nie ma jeszcze Stripe Customera (sesja checkout niezamintowana).
      // Stan PRZEJŚCIOWY i naprawialny po stronie klienta (odśwież panel i powtórz),
      // więc NIE opaque 500 z grupy „awaria Stripe" — klient musi umieć odróżnić
      // „spróbuj ponownie za chwilę" od realnej awarii dostawcy. Sam invariant jest
      // raportowany operatorowi w miejscu wykrycia (vat-invoice.operations.ts).
      return respondConflict(res, APP_EVENTS.INFO.ACCOUNT.CANNOT_MAKE_PAYMENT, {
        accountId: error.accountId,
      });

    // F-merge: all map to an opaque 500 (respondGeneralError(res, undefined)) —
    // each is logged server-side at its source; the client never sees the cause.
    // Shared fall-through keeps that contract byte-identical (precedent:
    // DATABASE_ERROR / EXTERNAL_SERVICE_ERROR above). Per-case rationale preserved:
    // - ACCOUNT_STRIPE_ERROR: stripeError holds Stripe-internal messages (customer IDs, API key info).
    // - CHECKOUT_PRICE_RESOLVE_FAILED: Stripe price lookup failed (transient/config) — opaque 500, like ACCOUNT_STRIPE_ERROR.
    // - CHECK_ACCESS_URL_NETWORK: reason logged server-side, not leaked to client.
    // - CONTACT_FORM_NO_ADMIN_EMAIL: misconfiguration — already logged server-side; client gets generic error.
    // - SUBSCRIBE_FAILED: newsletter subscribe failure — opaque 500, no detail exposed.
    case 'ACCOUNT_STRIPE_ERROR':
    case 'CHECKOUT_PRICE_RESOLVE_FAILED':
    case 'CHECK_ACCESS_URL_NETWORK':
    case 'CONTACT_FORM_NO_ADMIN_EMAIL':
    case 'SUBSCRIBE_FAILED':
      return respondGeneralError(res, undefined);

    // ── Admin errors ──
    case 'ADMIN_INSUFFICIENT_PERMISSIONS':
      return respondForbidden(res, {
        requiredRole: error.requiredRole,
        currentRole: error.currentRole,
      });

    case 'ADMIN_TARGET_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
        targetId: error.targetId,
        targetType: error.targetType,
      });

    case 'ADMIN_TARGET_PROTECTED':
      // 403 with reason — admin tried to act on themselves or another admin.
      // Reason exposed (not sensitive); UI uses it to render a specific message.
      return respondForbidden(res, { reason: error.reason });

    case 'ADMIN_POLICY_IS_MAIN_CANNOT_DELETE':
      // 400 Bad Request — admin tried to delete the main (active) legal policy.
      // Deleting it would leave a zero-main-policy state; the admin must promote
      // another policy to main first. Same respondBadRequest(res, event, payload)
      // shape as ADMIN_RESOURCE_HAS_REFERENCES. policyId echoed for the UI.
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ADMIN.CANNOT_DELETE_MAIN_POLICY,
        { policyId: error.policyId }
      );

    case 'ADMIN_RESOURCE_HAS_REFERENCES':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ADMIN.RESOURCE_HAS_REFERENCES,
        {
          resourceId: error.resourceId,
          resourceType: error.resourceType,
          referenceCount: error.referenceCount,
        }
      );

    case 'ADMIN_DUPLICATE_RESOURCE_NAME':
      // 409 Conflict — create/update hit a unique constraint (P2002) on the
      // resource name. No dedicated INFO event for admin name collisions exists;
      // VALIDATION_FAILED is the closest existing semantic (a duplicate name is a
      // validation conflict). resourceType + name echoed so the UI can render a
      // specific "name already taken" message.
      return respondConflict(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        {
          resourceType: error.resourceType,
          name: error.name,
        }
      );

    case 'ADMIN_SYSTEM_ROLE_IMMUTABLE':
      // 403 — attempt to edit a config-defined system role (MASTER_ADMIN wildcard).
      // Write would be a runtime no-op + misleading audit diff; rejected at the
      // operation (see admin-permissions.operations.ts). roleId echoed for the UI.
      return respondForbidden(res, { roleId: error.roleId });

    case 'IMPERSONATION_SENSITIVE_BLOCKED':
      // 403 Forbidden — admin impersonating user attempted sensitive mutation
      // (email change, account deletion). Audit event already emitted at the
      // gate (see admin-impersonation.utils.ts → enforceImpersonationGate_IO).
      // Admin-facing copy explains override path (query param) without leaking
      // implementation details to non-admin observers.
      return respondForbidden(
        res,
        {
          command: error.command,
          adminUserId: error.adminUserId,
          targetUserId: error.targetUserId,
        },
        APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_BLOCKED
      );

    case 'CHECK_ACCESS_URL_FORBIDDEN':
      return respondForbidden(res, undefined);

    // CHECK_ACCESS_URL_NETWORK + CONTACT_FORM_NO_ADMIN_EMAIL merged into the shared
    // respondGeneralError fall-through (see ACCOUNT_STRIPE_ERROR block above).

    // ── Client errors ──
    case 'CLIENT_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
        clientId: error.clientId,
      });

    case 'CLIENT_UNAUTHORIZED_ACCESS':
      // SECURITY: do NOT echo stylistAccountId — it is an internal cuid resolved
      // server-side from the stylist's user id (not caller input), and leaking it
      // in a 403 body exposes an internal account identifier. clientId is the
      // caller's own input (no info gained). error.stylistAccountId is still
      // consumed server-side (union completeness) but kept out of the response.
      return respondForbidden(
        res,
        { clientId: error.clientId },
        APP_EVENTS.INFO.CLIENT.NOT_PAIRED_WITH_CLIENT
      );

    // ── Visit errors ──
    case 'CLIENT_CARD_PLAN_LOCKED':
      return respondForbidden(
        res,
        { planType: error.planType },
        APP_EVENTS.INFO.VISIT.CLIENT_CARD_PLAN_LOCKED
      );

    case 'VISIT_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.VISIT.VISIT_NOT_FOUND, {
        visitId: error.visitId,
      });

    // ── SalonStaff errors ──
    case 'SALON_STAFF_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
        staffId: error.staffId,
      });

    case 'SALON_STAFF_ALREADY_EXISTS':
      // SECURITY: Do not echo email back — prevents account enumeration via staff invite probing
      return respondStaffAlreadyExists(res, undefined);

    case 'SALON_STAFF_SELF_INVITE':
      // 400 — salon owner tried to enroll their OWN account as staff (meaningless +
      // burns a paid quota slot). @@unique([stylist_account_id, user_id]) cannot catch
      // it (account_id vs user_id are different entities); rejected in the operation.
      // SECURITY: no accountId echoed (consistent with SALON_STAFF_ALREADY_EXISTS no-leak).
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.SALON_STAFF.CANNOT_INVITE_STAFF,
        undefined
      );

    // SALON_STAFF_LIMIT_REACHED merged into the shared respondPlanLimitReached
    // fall-through (see GALLERY_LIMIT_REACHED block above).

    // ── Email errors ──
    case 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        { reason: 'Invalid unsubscribe token' }
      );

    case 'EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        { reason: 'Unsubscribe token expired' }
      );

    case 'EMAIL_USER_NOT_FOUND':
      // SECURITY: Do not echo userId — prevents user enumeration on public endpoints
      return respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {});

    // DECISION (nie usuwaj tego komentarza):
    // EMAIL_SEND_FAILED case removed — domain error union no longer includes it.
    // INFO event APP_EVENTS.INFO.EMAIL.EMAIL_SEND_FAILED still exists and is logged
    // server-side via reportIssueBackend / event log (see email-transport.ts), but it
    // never propagates to client as a domain error result (no operation returns it).

    case 'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE':
      // 400 — client requested unsubscribe from a non-unsubscribable (TRANSACTIONAL)
      // category (PKE compliance). Honest 400 instead of a misleading 200-success for
      // a no-op. error.category is part of the error type (safe, non-PII).
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        {
          reason: 'Transactional emails cannot be unsubscribed',
          category: error.category,
        }
      );

    case 'EMAIL_CHANGE_INVALID_TOKEN':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_INVALID_TOKEN,
        { reason: 'Invalid email change token' }
      );

    // DECISION (nie usuwaj tego komentarza):
    // EMAIL_CHANGE_TOKEN_EXPIRED and DELETE_CONFIRM_TOKEN_EXPIRED cases removed —
    // operations use single INVALID_TOKEN state for both not-found and expired tokens.
    // TTL distinction deferred to post-launch. INFO events for "token expired" still
    // exist in APP_EVENTS but are not surfaced as a distinct domain error today.

    case 'DELETE_CONFIRM_INVALID_TOKEN':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.USER.USER_DELETE_INVALID_TOKEN,
        { reason: 'Invalid delete confirmation token' }
      );

    // ── Moderation errors ──
    case 'CONTENT_REPORT_NOT_FOUND':
      return respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
        reportId: error.reportId,
      });

    case 'CONTENT_REPORT_ALREADY_RESOLVED':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.ADMIN.CANNOT_RESOLVE_REPORT,
        { reportId: error.reportId }
      );

    case 'CONTENT_REPORT_RATE_LIMITED':
      return respondTooManyRequests(
        res,
        APP_EVENTS.INFO.GALLERY.REPORT_RATE_LIMITED,
        { currentCount: error.currentCount, limit: error.limit }
      );

    // CONTENT_REPORT_DUPLICATE = legacy any-status fallback (now only a defensive
    // PK-collision path). CONTENT_REPORT_DUPLICATE_PENDING = a still-open PENDING
    // duplicate (admin-moderation-4: re-report AFTER resolution is allowed, only an
    // unresolved duplicate blocks). Same UX: 400 CANNOT_REPORT_CONTENT. SECURITY: no
    // reporterId echo.
    case 'CONTENT_REPORT_DUPLICATE':
    case 'CONTENT_REPORT_DUPLICATE_PENDING':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.GALLERY.CANNOT_REPORT_CONTENT,
        { galleryRecordId: error.galleryRecordId }
      );

    case 'CONTENT_REPORT_SELF_REPORT':
      // 403 Forbidden — caller tried to report their OWN gallery record. This is a
      // forbidden action, NOT a 409 duplicate ("already reported") — the semantics
      // differ, so it gets a dedicated event. respondForbidden signature is
      // (res, data, event?) — data first, event last.
      // SECURITY: Do not echo reporterId — unnecessary PII in error response.
      return respondForbidden(
        res,
        { galleryRecordId: error.galleryRecordId },
        APP_EVENTS.INFO.GALLERY.CONTENT_REPORT_SELF_REPORT
      );

    // ── Support errors ──
    // SECURITY (anti-enumeration): SUPPORT_THREAD_NOT_AUTHORIZED — a thread that
    // exists but belongs to another user — MUST be byte-for-byte indistinguishable
    // from SUPPORT_THREAD_NOT_FOUND, otherwise the 403-vs-404 split leaks which
    // thread ids are real (IDOR enumeration). Sharing this single case via
    // fall-through STRUCTURALLY guarantees the identical 404 status, generic event
    // and payload shape ({ threadId } — caller's own input, no info gained).
    // Matches IDOR-masking used elsewhere (EMAIL_USER_NOT_FOUND).
    // DECISION (nie usuwaj tego komentarza): the response is INTENTIONALLY a 404
    // "not found" for the authorization failure — do not split it back to a 403.
    case 'SUPPORT_THREAD_NOT_FOUND':
    case 'SUPPORT_THREAD_NOT_AUTHORIZED':
      return respondNotFound(
        res,
        APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_NOT_FOUND,
        { threadId: error.threadId }
      );

    case 'SUPPORT_THREAD_CLOSED':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_CLOSED,
        { threadId: error.threadId }
      );

    case 'SUPPORT_RATE_LIMITED':
      // Per-user hourly support quota exceeded (create-thread / add-message).
      // 429 back-off, consistent with the other retryable/rate-limit 429 paths.
      // Reuses the generic RATE_LIMIT_EXCEEDED_INFO event (i18n-covered); no payload.
      return respondTooManyRequests(
        res,
        APP_EVENTS.INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
        undefined
      );

    // ── Messaging errors ──
    // Anti-enumeration: MESSAGING_PAIR_NOT_FOUND covers BOTH "para nie istnieje"
    // i "wołający nie jest stroną" — jedno 404, żeby 403-vs-404 nie zdradzał
    // realnych pair_id (parytet SUPPORT_THREAD_NOT_FOUND/NOT_AUTHORIZED).
    case 'MESSAGING_PAIR_NOT_FOUND':
      return respondNotFound(
        res,
        APP_EVENTS.INFO.MESSAGING.MESSAGING_PAIR_NOT_FOUND,
        undefined
      );

    case 'MESSAGING_NOT_ALLOWED':
      // Caller JEST stroną, ale para REVOKED → wysyłka zablokowana (403, bez maski).
      // UWAGA na kolejność: `respondForbidden` bierze DANE jako drugi argument,
      // a event jako trzeci — odwrotnie niż respondNotFound/Conflict/TooMany
      // w tym samym pliku. Zamienione argumenty kompilowały się bez szmeru
      // (payload jest generykiem), więc koperta niosła generyczne
      // ACCESS_DENIED_INFO, a w `data` lądował STRING z nazwą eventu — front
      // gubił przez to przetłumaczony komunikat „wiadomości tylko w aktywnym
      // połączeniu" i pokazywał ogólne „brak dostępu".
      return respondForbidden(
        res,
        undefined,
        APP_EVENTS.INFO.MESSAGING.MESSAGING_NOT_ALLOWED
      );

    case 'MESSAGING_RATE_LIMITED':
      // Prawdziwe okno odblokowania liczy operacja (najstarsza wiadomość
      // w oknie) — patrz DECISION przy respondDomainRateLimited.
      return respondDomainRateLimited(
        res,
        APP_EVENTS.INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
        error.retryAfterSeconds
      );

    // ── Newsletter errors ──
    case 'ALREADY_SUBSCRIBED':
      // DECISION (nie usuwaj): Returning success to prevent email enumeration; matches pending-confirmation shape
      return respondSuccess(
        res,
        { subscribed: true, pending_confirmation: true },
        APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION
      );

    // SUBSCRIBE_FAILED merged into the shared respondGeneralError fall-through
    // (see ACCOUNT_STRIPE_ERROR block above).

    case 'NEWSLETTER_INVALID_TOKEN':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_INVALID_TOKEN,
        { reason: 'Invalid or expired newsletter confirmation token' }
      );

    case 'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND':
      return respondNotFound(
        res,
        APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_UNSUBSCRIBE_NOT_FOUND,
        { reason: 'No newsletter subscription found for this token' }
      );

    // ── SessionContainer errors ──
    case 'SESSION_CONTAINER_NOT_FOUND':
      return respondNotFound(
        res,
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_FOUND,
        { sessionId: error.sessionId }
      );

    case 'SESSION_CONTAINER_NOT_AUTHORIZED':
      return respondForbidden(
        res,
        { sessionId: error.sessionId },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_AUTHORIZED
      );

    case 'SESSION_CONTAINER_NOT_PAIRED':
      return respondForbidden(
        res,
        {
          clientUserId: error.clientUserId,
          stylistAccountId: error.stylistAccountId,
        },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOT_PAIRED
      );

    case 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED':
      return respondTooManyRequests(
        res,
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED,
        {
          clientAccountId: error.clientAccountId,
          currentCount: error.currentCount,
          limit: error.limit,
        }
      );

    case 'SESSION_CONTAINER_INVALID_STATE':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_INVALID_STATE,
        {
          sessionId: error.sessionId,
          currentState: error.currentState,
          attemptedAction: error.attemptedAction,
        }
      );

    case 'SESSION_CONTAINER_EMPTY':
      return respondBadRequest(
        res,
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_EMPTY,
        { sessionId: error.sessionId }
      );

    case 'SESSION_CONTAINER_PHOTO_OWNERSHIP':
      return respondForbidden(
        res,
        {
          sessionId: error.sessionId,
          galleryRecordId: error.galleryRecordId,
          expectedStylistAccountId: error.expectedStylistAccountId,
        },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_OWNERSHIP
      );

    case 'SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED':
      return respondTooManyRequests(
        res,
        APP_EVENTS.INFO.SESSION_CONTAINER
          .SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED,
        {
          stylistAccountId: error.stylistAccountId,
          currentCount: error.currentCount,
          limit: error.limit,
        }
      );

    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      // DD-L2: log the unmapped error type so debugging is possible —
      // payload is intentionally minimal (no leaked PII), only the discriminant.
      reportIssueBackend({
        namespace: 'ERROR_MAPPER_DEFAULT',
        message: 'Unmapped error type encountered',
        payload: { errorType: (error as { type?: string }).type },
        mode: 'error',
      });
      return respondGeneralError(res, undefined);
    }
  }
}
