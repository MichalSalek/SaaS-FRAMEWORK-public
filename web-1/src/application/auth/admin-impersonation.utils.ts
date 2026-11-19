/**
 * ADMIN IMPERSONATION CONTEXT + SENSITIVE-MUTATION GATE
 *
 * Hardens the become-user flow against account hijacking by an admin (e.g. an e-mail change whose
 * confirmation lands in an admin-controlled inbox) or by a socially-engineered support agent.
 */

// DECISION: HYBRID gate: BLOCK sensitive mutations by default, but allow an explicit admin override
// via `?override_impersonation_block=true`. A hard block is too rigid (a support admin fixing a
// typo'd signup e-mail needs this path; a manual DB edit has no audit trail). BLOCKED and OVERRIDE
// both write `EventLogTypeValue.ADMIN` rows with `created_by_user_id = adminUserId`. The override
// is a query param (not body or header): clear intent, visible in proxy logs, hard to set by
// accident; there is no UI for it.

// DECISION: SERVER TRUTH FIRST. The threat model is a malicious admin, who controls the client:
// omitting the `become-user` header made every gated mutation run as a plain user mutation with no
// audit row. The authoritative signal is the session: become-user records the impersonated session
// token in ImpersonationBackup, so a request authenticated with that token IS impersonated whatever
// headers it carries. The HMAC header stays as a second path (either gates). One row per admin and
// a lookup only for sensitive commands keep it cheap.
// Test: web-1/src/application/auth/admin-impersonation.utils.test.ts (covers gating by session
// token without the header; not other headers/paths).

// DECISION: header detection trusts ONLY the HMAC-verified opaque token, never the raw header. A
// spoofed header fails `verifyImpersonationBackup` and falls through to "not impersonating" (fails
// open): the rest of the stack (session, role permissions, account guards) still applies. The gate
// targets an admin acting inside an impersonated session, not generic header forgery.

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

    APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
    // ADRR Model A: self-disable (is_active=false + disabled_at, kills sessions,
    // locks account behind admin-only re-enable). Admin-only-reversible by design
    // — an impersonating admin triggering it would lock the user out under their
    // own (admin) authority without a flagged audit trail. Gate it like the other
    // destructive self-only mutations.
    APP_EVENTS.COMMANDS.USER.USER_DISABLE_SELF,
    // DECISION: consent and money are gated too. Under impersonation these ran as the user's own
    // act, so an admin could grant marketing consent or start a charge that the trail recorded as the
    // user's choice. Both are the user's decision by definition; the override query param still lets
    // support act, with the admin named in the row.
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
    APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_ACCEPT_TOKEN,
    APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_INVITE,
    APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_RESPOND_INVITATION,
    APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_LEAVE_TEAM,
    APP_EVENTS.COMMANDS.SALON_PROFILE.SALON_PROFILE_UPDATE,
    APP_EVENTS.COMMANDS.SALON_PROFILE.SALON_PROFILE_VISIBILITY_UPDATE,
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

  // DECISION: CALLER-BINDING (parity with the switch-back/refresh redeem in
  // impersonation-backup.utils, where impersonated_user_id is a positive binding). The gate
  // activates only when the opaque token belongs to THIS session: `backup.impersonated_user_id` MUST
  // equal the caller. Without it, replaying the header of ANOTHER admin's backup (valid HMAC,
  // different target) would pass the gate with that foreign backup's adminUserId and misattribute
  // the BLOCKED/OVERRIDE audit row to an admin who never impersonated this user. A mismatch is
  // fail-open (like a bogus header); the rest of the auth stack (BA session, RBAC, account guards)
  // still applies.
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
 *   - Not impersonating OR not a sensitive command: `success(...)`, no DB writes.
 *   - Impersonating + sensitive, no override param: audit event
 *     `IMPERSONATION_SENSITIVE_BLOCKED` and `failure(...)`.
 *   - Impersonating + sensitive + `?override_impersonation_block=true`: audit
 *     event `IMPERSONATION_SENSITIVE_OVERRIDE` and `success`.
 *
 * Audit rows use `writeRawEventLog_IO` (NOT recordAuditEvent_IO) because
 * `created_by_user_id` must be the admin, while `currentUser.id` here is the
 * IMPERSONATED user and the wrapper would hide the admin.
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
    // DECISION: the audit write is `await`ed (not fire-and-forget) so the row hits the DB BEFORE the
    // sensitive mutation runs. If the write fails (DB outage) we still proceed: the override is
    // logged by writeRawEventLog_IO's internal reportIssueBackend, so it surfaces in the issue
    // tracker even if the EventLog row never lands.
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
