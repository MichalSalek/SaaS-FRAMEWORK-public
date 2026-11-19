import type { NextApiHandler } from 'next';
import { createManualSessionForUser_IO } from '@domain/user/operations/user-session.operations';
import { seedTestClient_IO } from '@domain/admin/operations/admin-seeding.operations';
import {
  isInternalSecretConfigured,
  verifyInternalSecret,
} from '@app/auth/verify-internal-secret';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { isAllowedOrigin, setCORSHeaders } from '@app/cors/cors.middleware';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  IS_DEVELOPMENT_ENV,
  IS_PRODUCTION_ENV,
} from '@app/environment/environment.utils.api';
import { isAdminEmail } from '@app/admin/admin.utils.api';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { setClientHeader } from '@app/headers/headers.utils';
import { SESSION_HEADER_NAME } from '@app/auth/session/session.utils.api';
import { getClientInfoFromReq } from '@app/http/extract-client-info';
import {
  makeCurrentUser,
  toSafeCurrentUser,
} from '@domain/user/user.utils.api';
import {
  AccountStatusValue,
  AccountTypeValue,
  EventLogTypeValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { narrowUser } from '@kernel/models/type_narrowing';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { HTTPRequestHandlerMiddleware } from '@app/http/request.middleware';
import { withRawSecretHandler } from '@app/http/define-raw-handler';
import {
  respondGeneralError,
  respondNotAcceptable,
  respondNotFound,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

const checkInternalSecret = (
  providedHeader: string | string[] | undefined
): boolean => {
  // No secret configured: in DEV graceful-allow; in PROD fail-closed (caller handles 404).
  if (!isInternalSecretConfigured()) {
    return !IS_PRODUCTION_ENV();
  }
  return verifyInternalSecret(providedHeader);
};

// DECISION: wrapped in `withRawSecretHandler({ failClosedMode: 'custom' })`: the wrapper gives ONLY the
// timing/error scaffold, while the security-critical prelude order stays VERBATIM in `handle` and
// DELIBERATELY differs from the shared withPublicHandler:
//   (1) OPTIONS -> 204 FIRST (a preflight carries no x-internal-secret),
//   (2) checkInternalSecret (env-aware) -> 404 mask BEFORE isAllowedOrigin, else an origin reject (406)
//       would leak the endpoint's existence,
//   (3) env gate (PROD -> 404 mask, not 403: no "secret OK but env wrong" side channel),
//   (4) only then isAllowedOrigin/setCORS + the CQRS HTTPRequestHandlerMiddleware.
// Wrapping this order in the shared CORS-first prelude would break the 404 mask. Better a raw handler
// than broken auth.
const handler: NextApiHandler = async (req, res) => {
  // DD2-L2 r28: CORS preflight MUST be answered BEFORE secret/env gates.
  // Browser preflight OPTIONS does not carry custom headers (including
  // x-internal-secret), so running it through checkInternalSecret would fail
  // → 404 → the real POST never fires. Mirror request.middleware.ts:142-145
  // pattern: short-circuit OPTIONS with 204 + CORS headers, no payload.
  if (req.method === 'OPTIONS') {
    setCORSHeaders({ req, res });
    res.status(204).end();
    return;
  }

  // M9 r28: INTERNAL_SHARED_SECRET defense-in-depth FIRST (before IS_DEVELOPMENT_ENV).
  // PROD without secret OR missing/wrong header → 404 mask (do not leak endpoint existence).
  // Reuse DEV_LOGIN_BLOCKED info event — semantically "this auth path is denied".
  if (!checkInternalSecret(req.headers[CUSTOM_HEADERS.xInternalSecret])) {
    respondNotFound(res, APP_EVENTS.INFO.USER.DEV_LOGIN_BLOCKED, undefined);
    return;
  }

  // DD2-L1 r28: 404 mask (not 403) when secret PASSES but env is PROD.
  // A 403 here would be a side-channel — secret holder learns "secret is correct
  // but env is wrong", which leaks deployment state. 404 is identical to the
  // secret-fail branch above, so the endpoint surface is uniform.
  if (!IS_DEVELOPMENT_ENV()) {
    respondNotFound(res, APP_EVENTS.INFO.USER.DEV_LOGIN_BLOCKED, undefined);
    return;
  }

  if (!isAllowedOrigin({ req, res })) {
    respondNotAcceptable(
      res,
      APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
      undefined
    );
    return;
  }
  setCORSHeaders({ req, res });

  await HTTPRequestHandlerMiddleware<USER_DTO_API_V1['DEV_LOGIN']['REQUEST']>(
    req,
    res,
    {
      eventName: APP_EVENTS.COMMANDS.USER.DEV_LOGIN,
      contestedHTTPMethod: 'post',
      validationFunction: (data: unknown) => {
        const email =
          typeof data === 'object' && data !== null && 'email' in data
            ? data.email
            : undefined;
        if (typeof email !== 'string' || !email.includes('@')) {
          return { __isValid: false, email: 'invalid email' };
        }
        return { __isValid: true, __data: { email } };
      },
      businessLogic: async body => {
        // DECISION: lowercase the e-mail on input. isAdminEmail normalizes itself, but Prisma
        // findUnique({ where: { email } }) is case-sensitive, so "Test-Admin@..." would create a duplicate
        // beside the seeded "test-admin@..." with different roles. One canonical form on every DB path.
        const email = body.email.trim().toLowerCase();

        // DECISION: withoutRole (dev-only query param) creates a FRESH user with NO stylist_account and NO
        // client_account, the real state after signup and before onboarding (Better Auth databaseHooks
        // creates the User without account relations). Seeded test users are already post-onboarding, so
        // the e2e funnel-prefill spec could not reach the "both accounts null" state. The onboarding guard
        // (DashboardPage.useOnboardingGuard) routes to /app/onboarding when stylist_account===null &&
        // client_account===null && role!=='admin'; STYLIST_ROLE + account_type CLIENT (below) satisfies it.
        // A query param, not a body DTO, to avoid kernel changes (USER_DTO_API_V1.DEV_LOGIN). Applies only
        // to a NEW user; an existing one is never downgraded. The whole path is behind the dev gate.
        const wantsRolelessAccount =
          (Array.isArray(req.query.withoutRole)
            ? req.query.withoutRole[0]
            : req.query.withoutRole) === 'true';

        try {
          // Quick login „Test Client": restore the single-role client before the
          // session shows her (why at login and not only in the seed: see the
          // DECISION at seedTestClient_IO).
          if (email === TEST_USERS_CONFIG.CLIENT.email) {
            await seedTestClient_IO();
          }

          // Find or create user (mirrors Better Auth databaseHooks.user.create)
          let user = await DB_CLIENT.use.user.findUnique({
            where: { email },
            include: { stylist_account: true, client_account: true },
          });

          const isNewUser = !user;

          // DECISION: role assignment for dev-login (create AND existing branches): the MASTER_ADMIN_EMAIL
          // allow-list or the TEST_USERS_CONFIG.ADMIN e-mail => MASTER_ADMIN; everyone else => STYLIST_ROLE
          // (legacy backward compat for smoke tests). Without it dev-login for MASTER_ADMIN_EMAIL got
          // STYLIST_ROLE and the admin gates fired even with a valid session.
          const intendedRoleId:
            | typeof SystemRoleId.MASTER_ADMIN
            | typeof SystemRoleId.STYLIST_ROLE =
            isAdminEmail(email) || email === TEST_USERS_CONFIG.ADMIN.email
              ? SystemRoleId.MASTER_ADMIN
              : SystemRoleId.STYLIST_ROLE;

          if (!user && wantsRolelessAccount) {
            // DECISION: role-less fresh user (see the withoutRole DECISION above): no stylist_account and no
            // client_account => onboarding-eligible. role_id is NOT NULL, so STYLIST_ROLE is the benign
            // default (same as intendedRoleId for non-admins); account_type=CLIENT (the schema default) makes
            // useAppRole compute role='client' (not admin), so the guard sees both accounts null and routes
            // to onboarding. is_active=true => deriveAccountRecoveryState='active' (no bounce to /app/recover).
            user = await DB_CLIENT.use.user.create({
              data: {
                email,
                role_id: SystemRoleId.STYLIST_ROLE,
                account_type: AccountTypeValue.CLIENT,
                is_active: true,
                // Dev-login accounts are admitted without proof of the mailbox.
                // The stamp matches magic-link accounts, so a later Google sign-in
                // on the same address links instead of returning `account_not_linked`.
                emailVerified: true,
              },
              include: { stylist_account: true, client_account: true },
            });
          } else if (!user) {
            // account_type explicit — schema default to CLIENT, ale tworzymy
            // stylist_account inline, wiec User MUSI byc STYLIST dla spojnosci
            // z initializeMasterAdmin_IO i seedTestUsers_IO (te tez set STYLIST).
            user = await DB_CLIENT.use.user.create({
              data: {
                email,
                role_id: intendedRoleId,
                account_type: AccountTypeValue.STYLIST,
                is_active: true,
                emailVerified: true,
                stylist_account: {
                  create: {
                    display_name: email.split('@')[0] ?? email,
                    address_city: 'Test City',
                    pricing_plan: PricingPlanValue.FREE,
                    payment_status: PaymentStatusValue.PAID,
                    account_status: AccountStatusValue.ACTIVE,
                  },
                },
              },
              include: { stylist_account: true, client_account: true },
            });
          } else if (
            intendedRoleId === SystemRoleId.MASTER_ADMIN &&
            user.role_id !== SystemRoleId.MASTER_ADMIN
          ) {
            // DECISION: reconcile the MASTER_ADMIN role on an EXISTING user. The role used to be stamped only
            // in the create branch; if a seeded admin (MASTER_ADMIN_EMAIL / TEST_USERS_CONFIG.ADMIN) drifted
            // to role_stylist (onboarding downgrade, or delete+recreate by a parallel tester), dev-login
            // returned a STYLIST session and requireTargetNotProtected (role_id === MASTER_ADMIN) stopped
            // protecting it from cross-admin disable/delete. Mirrors the idempotent repair in
            // admin-seeding.operations.ts (initializeMasterAdmin_IO, seedTestUsers_IO). Reconcile only UPWARD
            // to MASTER_ADMIN for configured admin e-mails; non-admins are never touched (a legit user may
            // hold another role on purpose). Dev-gated: in prod, admins come from the env allow-list at
            // Better Auth signup.
            user = await DB_CLIENT.use.user.update({
              where: { id: user.id },
              data: { role_id: SystemRoleId.MASTER_ADMIN },
              include: { stylist_account: true, client_account: true },
            });
          }

          const narrowedUser = narrowUser<UserWithRelations>(user, 'dev-login');
          if (!narrowedUser) {
            respondGeneralError(res, undefined);
            return;
          }

          // Create session
          const { ip, userAgent } = getClientInfoFromReq(req.headers);

          const sessionResult = await createManualSessionForUser_IO({
            id: narrowedUser.id,
            ip,
            userAgent,
          });

          if (!sessionResult.success) {
            respondGeneralError(res, undefined);
            return;
          }

          const session = sessionResult.data;

          setClientHeader({
            req,
            res,
            payload: {
              name: SESSION_HEADER_NAME,
              value: session.token,
            },
          });

          const currentUser = makeCurrentUser({ user: narrowedUser, session });

          // Log
          await writeRawEventLog_IO({
            eventName: APP_EVENTS.INFO.USER.DEV_LOGIN_SUCCESS,
            eventLogType: EventLogTypeValue.LOGIN,
            meta: { created_by_user_id: narrowedUser.id },
            eventPayloadToStringify: { email, isNewUser },
          });

          reportIssueBackend({
            namespace: 'DEV_LOGIN',
            message: `Dev login success for ${email}`,
            payload: { email, isNewUser },
            mode: 'info',
          });

          // SECURITY: strip session.token + session.userId before serializing.
          // Token persists in Authorization header (out-of-band) + DB; never in body.
          respondSuccess(
            res,
            toSafeCurrentUser(currentUser),
            APP_EVENTS.INFO.USER.DEV_LOGIN_SUCCESS
          );
        } catch (e) {
          reportIssueBackend({
            namespace: 'DEV_LOGIN',
            message: 'Error in dev login',
            payload: e,
            mode: 'error',
          });
          respondGeneralError(res, undefined);
        }
      },
    }
  );
};

// failClosedMode 'custom': the secret/env policy stays inside `handler` (see DECISION
// above) — the wrapper adds only the timing scaffold + an uncaught-error safety net.
export default withRawSecretHandler({
  allowedMethods: ['POST'],
  failClosedMode: 'custom',
  handle: handler,
});
