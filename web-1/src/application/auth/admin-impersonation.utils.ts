/**
 * ADMIN IMPERSONATION CONTEXT + SENSITIVE-MUTATION GATE
 *
 * PLQS Wave 4D (F4-7): hardens become-user flow against admin-side account
 * hijacking. Two attack surfaces this gate closes:
 *
 *   1. Malicious admin starts impersonation, triggers USER_REQUEST_EMAIL_CHANGE
 *      → confirmation lands at admin-controlled inbox → account stolen.
 *   2. Socially-engineered support agent (post team-growth) tricked into
 *      "becoming" a user and triggering self-only operations on their behalf.
 *
 * Detection vector: the FE always replays the opaque `become-user` header on
 * every subsequent request while impersonation is active (see
 * `main/src/application/http/http.utils.ts` line 23 — header is mirrored from
 * sessionStorage into every fetch). We HMAC-verify that token here and confirm
 * it belongs to a DIFFERENT admin than `currentUser` — if so, the request is
 * happening inside an impersonated session.
 *
 * DECISION (nie usuwaj tego komentarza):
 * HYBRID gate: BLOCK sensitive mutations by default, but allow explicit admin
 * override via `?override_impersonation_block=true` query param. Reasoning:
 *   - HARD BLOCK is too rigid — a support admin legitimately fixing a corrupted
 *     user email (e.g. typo at signup) WOULD need this path; forcing a manual
 *     DB edit is worse (no audit trail, no envelope, no error surface).
 *   - AUDIT ALWAYS (BLOCKED and OVERRIDE both write `EventLogTypeValue.ADMIN`
 *     rows with `created_by_user_id = adminUserId` so the master audit trail
 *     shows the human responsible). Deterrence + post-incident forensics.
 *   - OVERRIDE via QUERY PARAM (not body, not header) — clear intent, easy to
 *     spot in proxy logs, hard to set by accident from a normal client flow.
 *     UI for it deferred: admin can hit the URL directly via Postman/curl when
 *     genuinely needed (rare; explicitly out-of-scope for this wave).
 *
 * DECISION (nie usuwaj tego komentarza) — SERVER TRUTH FIRST (testy-api s34):
 * the header is replayed by OUR frontend, but the threat model is a malicious admin,
 * and that admin controls the client: omitting `become-user` made every gated
 * mutation run as a plain user mutation, with no BLOCKED/OVERRIDE row naming the
 * admin (measured: self-disable of the target → 200). The authoritative signal is
 * the session itself: become-user records the impersonated session token in
 * ImpersonationBackup, so a request authenticated with that token IS an impersonated
 * request whatever headers it carries. The HMAC header below stays as a second path
 * (either one gates). The table holds at most one row per admin, so the lookup is
 * cheap, and it only runs for the sensitive commands.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Detection trusts ONLY HMAC-verified opaque token (D23 backup pattern), not
 * the raw header value. A spoofed header without the IMPERSONATION_HMAC_SECRET
 * fails `verifyImpersonationBackup` and falls through to "not impersonating"
 * — i.e. the gate FAILS OPEN for unknown headers. This is correct: if a header
 * is bogus, we treat the request as a normal user mutation; the rest of the
 * stack (Better Auth session, role permissions, account guards) still applies.
 * The gate exists to catch the SPECIFIC threat of an authenticated admin
 * acting from inside an impersonated session — not generic header forgery.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Sensitive command list is a HARD-CODED SET, not a config flag. Reasoning:
 *   - The gated set is the self-only destructive mutations: USER_REQUEST_
 *     EMAIL_CHANGE, USER_REQUEST_DELETE, USER_GDPR_ERASE, USER_DISABLE_SELF.
 *     Magic-link only auth → no password change route exists (Better Auth
 *     `emailAndPassword` disabled).
 *   - Adding a command to the gate must be a code-review event, not a runtime
 *     toggle. A misconfigured flag that quietly stops gating is a silent
 *     regression; a compile-time list forces a PR.
 *   - USER_EXPORT_DATA intentionally OMITTED — admin /admin/user/export
 *     already requires admin role + has separate rate limit. Self-export
 *     during impersonation would still ship the export TO the user's email
 *     (recordAuditEvent_IO target = user.id), not the admin. Lower risk.
 */

import type { NextApiRequest } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { ImpersonationSensitiveBlockedError } from '@kernel/domain/admin/admin-errors.types';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

import { DB_CLIENT } from '@app/db/db.client';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { verifyImpersonationBackup } from '@domain/admin/impersonation-backup.utils';

// ----------------------------------------------------------------------------
// Configuration — sensitive commands + override query param
// ----------------------------------------------------------------------------

/**
 * Commands which MUST NOT silently fire from inside an impersonated session.
 * Each entry represents a self-only mutation whose result lands at the
 * `currentUser` (the IMPERSONATED user) — i.e. anything an admin shouldn't
 * be able to trigger on a user's behalf without leaving a flagged audit trail.
 *
 * Adding to this set requires a code-review PR (intentional change, no flags).
 * Enforced centrally in request.middleware for every command in the set, so a
 * new entry is gated without touching its handler.
 */
const SENSITIVE_COMMANDS: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> =
  new Set<EVENT_COMMANDS_AND_QUERIES_TYPE>([
    APP_EVENTS.COMMANDS.USER.USER_REQUEST_EMAIL_CHANGE,
    APP_EVENTS.COMMANDS.USER.USER_REQUEST_DELETE,
    // ADRR Model A: GDPR Art. 17 hard-delete — most destructive self-action;
    // an impersonating admin must not trigger permanent erasure without override.
    APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
    // ADRR Model A: self-disable (is_active=false + disabled_at, kills sessions,
    // locks account behind admin-only re-enable). Admin-only-reversible by design
    // — an impersonating admin triggering it would lock the user out under their
    // own (admin) authority without a flagged audit trail. Gate it like the other
    // destructive self-only mutations.
    APP_EVENTS.COMMANDS.USER.USER_DISABLE_SELF,
    // DECISION (nie usuwaj tego komentarza) — consent and money (testy-api s34):
    // under impersonation these ran as the user's own act, so an admin could
    // grant marketing consent or start a charge that the trail recorded as the
    // user's choice. Both are the user's decision by definition; the override
    // query param still lets support act, with the admin named in the row.
    APP_EVENTS.COMMANDS.EMAIL.EMAIL_UPDATE_PREFERENCES,
    // Re-onboarding rewrites email_marketing from the body and stamps
    // terms_accepted_at: the same consent, through another door.
    APP_EVENTS.COMMANDS.USER.USER_ONBOARD_AS_STYLIST,
    APP_EVENTS.COMMANDS.USER.USER_ONBOARD_AS_CLIENT,
    APP_EVENTS.COMMANDS.USER.USER_UPDATE_NOTIFICATION_PREFERENCES,
    APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_CHECKOUT_SESSION,
    APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_PLAN_CHANGE,
    APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_STRIPE_PORTAL,
    APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_VAT_INVOICE_DETAILS,
  ]);

/**
 * Query param the admin must set explicitly to bypass the BLOCK and trigger
 * the OVERRIDE path. The value is treated as a boolean — only the literal
 * string `'true'` is accepted (no truthy parsing).
 */
const OVERRIDE_QUERY_PARAM = 'override_impersonation_block';
const OVERRIDE_QUERY_VALUE_TRUE = 'true';

// ----------------------------------------------------------------------------
// Impersonation context detection (HMAC-verified, defense in depth)
// ----------------------------------------------------------------------------

export type ImpersonationContext =
  | { isImpersonating: false }
  | {
      isImpersonating: true;
      adminUserId: string;
      targetUserId: string;
    };

/**
 * The admin who owns the impersonation this session token belongs to, or null.
 * Bound to the caller too (impersonated_user_id), parity with switch-back redeem.
 */
export const findImpersonatingAdminBySession_IO = async (params: {
  sessionToken: string;
  currentUserId: string;
}): Promise<string | null> => {
  const backup = await DB_CLIENT.use.impersonationBackup.findFirst({
    where: {
      impersonated_session_token: params.sessionToken,
      impersonated_user_id: params.currentUserId,
    },
    select: { admin_user_id: true },
  });
  return backup?.admin_user_id ?? null;
};

/**
 * Resolve impersonation context from request. The session token is checked
 * first (server truth, see SERVER TRUTH FIRST above); otherwise returns
 * `isImpersonating: false` when:
 *   - no `become-user` header present
 *   - header present but HMAC-invalid / expired / unknown ref_id (treated as
 *     "not impersonating", per DECISION above — fail-open for the gate, the
 *     rest of the auth stack still applies)
 *   - header valid but `currentUser.id === backup.admin_user_id` (caller IS
 *     the admin, not the impersonated target — no gate needed)
 */
export const getImpersonationContext_IO = async (params: {
  req: NextApiRequest;
  currentUserId: string;
  sessionToken: string;
}): Promise<ImpersonationContext> => {
  const { req, currentUserId, sessionToken } = params;

  const adminBySession = await findImpersonatingAdminBySession_IO({
    sessionToken,
    currentUserId,
  });
  if (adminBySession !== null && adminBySession !== currentUserId) {
    return {
      isImpersonating: true,
      adminUserId: adminBySession,
      targetUserId: currentUserId,
    };
  }

  const rawHeader = req.headers[CUSTOM_HEADERS.becomeUser];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (!headerValue) {
    return { isImpersonating: false };
  }

  // HMAC + DB lookup — D23 opaque token format `<refId>.<expiresAtMs>.<sig>`.
  const backup = await verifyImpersonationBackup(headerValue);
  if (!backup) {
    return { isImpersonating: false };
  }

  // If the caller IS the admin themselves, the header is stale (after switch-
  // back) or replayed by the admin's own session. The gate only fires for the
  // impersonated target, not the admin sitting on their own account.
  if (currentUserId === backup.admin_user_id) {
    return { isImpersonating: false };
  }

  // DECISION (nie usuwaj tego komentarza):
  // CALLER-BINDING (parytet ze switch-back/refresh redeem w impersonation-backup.utils,
  // gdzie impersonated_user_id jest pozytywnym wiązaniem). Gate aktywuje się TYLKO gdy
  // opaque token należy do TEJ sesji — `backup.impersonated_user_id` MUSI równać się
  // wołającemu. Bez tego replay headera z backup INNEGO admina (valid HMAC, inny target)
  // przeszedłby gate z adminUserId tego obcego backup, misatrybuując wiersz audytu
  // BLOCKED/OVERRIDE do admina, który nigdy nie impersonował tego użytkownika.
  // Niedopasowanie = fail-open (jak bogus header) — reszta stacka auth (sesja BA,
  // RBAC, account-guards) nadal obowiązuje.
  if (backup.impersonated_user_id !== currentUserId) {
    return { isImpersonating: false };
  }

  return {
    isImpersonating: true,
    adminUserId: backup.admin_user_id,
    targetUserId: currentUserId,
  };
};

// ----------------------------------------------------------------------------
// Sensitive-command helpers
// ----------------------------------------------------------------------------

export const isSensitiveCommand = (
  command: EVENT_COMMANDS_AND_QUERIES_TYPE
): boolean => SENSITIVE_COMMANDS.has(command);

const hasOverrideQueryParam = (req: NextApiRequest): boolean => {
  const raw = req.query[OVERRIDE_QUERY_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === OVERRIDE_QUERY_VALUE_TRUE;
};

// ----------------------------------------------------------------------------
// Gate — call from sensitive handlers BEFORE running business logic
// ----------------------------------------------------------------------------

/**
 * Enforce the impersonation sensitive-mutation gate. Called ONCE per request by
 * request.middleware (after RBAC and the account-state gate), never by handlers:
 * a per-handler call is what let a new sensitive command go ungated.
 *
 * Behaviour:
 *   - Not impersonating OR not a sensitive command → returns `success(...)`
 *     immediately, no DB writes.
 *   - Impersonating + sensitive + no override query param → emits
 *     `IMPERSONATION_SENSITIVE_BLOCKED` audit event (created_by_user_id =
 *     admin) and returns `failure(IMPERSONATION_SENSITIVE_BLOCKED)`.
 *   - Impersonating + sensitive + `?override_impersonation_block=true` →
 *     emits `IMPERSONATION_SENSITIVE_OVERRIDE` audit event and returns
 *     `success` so the handler can proceed.
 *
 * Audit emission uses `writeRawEventLog_IO` directly (NOT recordAuditEvent_IO)
 * because we need `created_by_user_id = adminUserId` while `currentUser.id`
 * inside the handler is the IMPERSONATED user — the wrapper would default to
 * the impersonated user, hiding the admin in the audit trail.
 */
export const enforceImpersonationGate_IO = async (params: {
  req: NextApiRequest;
  command: EVENT_COMMANDS_AND_QUERIES_TYPE;
  currentUserId: string;
  sessionToken: string;
}): Promise<
  OperationResult<{ wasOverride: boolean }, ImpersonationSensitiveBlockedError>
> => {
  const { req, command, currentUserId, sessionToken } = params;

  // Fast-path: not a sensitive command at all — skip the verify lookup.
  if (!isSensitiveCommand(command)) {
    return success({ wasOverride: false });
  }

  const context = await getImpersonationContext_IO({
    req,
    currentUserId,
    sessionToken,
  });
  if (!context.isImpersonating) {
    return success({ wasOverride: false });
  }

  const auditMetaBase = {
    created_by_user_id: context.adminUserId,
    impersonated_by_admin_id: context.adminUserId,
  } as const;

  const auditPayload = {
    command,
    target_user_id: context.targetUserId,
    endpoint: req.url ?? null,
    method: req.method ?? null,
  };

  if (hasOverrideQueryParam(req)) {
    // Override path — admin explicitly bypassed the block. Audit + proceed.
    // DECISION (nie usuwaj tego komentarza):
    // We `await` the audit write here (not fire-and-forget) so the row hits
    // the DB BEFORE the sensitive mutation runs. If the audit write fails
    // (DB outage), we still proceed — the override is logged server-side via
    // writeRawEventLog_IO's internal reportIssueBackend on failure, so it
    // surfaces in the issue tracker even if the EventLog row never lands.
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_OVERRIDE,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: auditMetaBase,
      eventPayloadToStringify: { ...auditPayload, override: true },
    });
    return success({ wasOverride: true });
  }

  // BLOCK path — emit audit (admin = actor, target = impersonated user) and
  // return the typed error for mapErrorToResponse → 403 with admin-facing copy.
  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_BLOCKED,
    eventLogType: EventLogTypeValue.ADMIN,
    meta: auditMetaBase,
    eventPayloadToStringify: { ...auditPayload, override: false },
  });

  return failure({
    type: 'IMPERSONATION_SENSITIVE_BLOCKED',
    command,
    adminUserId: context.adminUserId,
    targetUserId: context.targetUserId,
  });
};
