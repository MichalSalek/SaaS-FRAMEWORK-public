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

// DECISION (nie usuwaj tego komentarza):
// M9 r28 — Defense-in-depth: dev-login creates MASTER_ADMIN inline (no MFA, no
// password, just an email). The IS_DEVELOPMENT_ENV() gate below is the primary
// defense, but NODE_ENV / NODE_ENV_MANUAL drift is a documented footgun
// (CLAUDE.md "Deployment Gotchas"). INTERNAL_SHARED_SECRET adds a second lock:
// a misconfigured production deploy that accidentally evaluates as "development"
// still cannot mint admin sessions without the secret header.
//
// Behavior:
//  • PROD env without INTERNAL_SHARED_SECRET configured → 404 mask (do not advertise the endpoint).
//  • PROD env with secret configured but missing/mismatched header → 404 mask.
//  • DEV env with INTERNAL_SHARED_SECRET configured → header MUST match (timing-safe).
//  • DEV env WITHOUT INTERNAL_SHARED_SECRET configured → allow (graceful local dev).
// 404 chosen over 403 to avoid leaking endpoint existence to unauthenticated probes.
// Pattern mirrors track-crawler (internal/track-crawler/index.ts) for consistency.
//
// BDX W1.4: timing-safe compare extracted to verifyInternalSecret (SSOT). This
// wrapper keeps the dev-login-specific POLICY: no secret configured ⇒ graceful-allow
// in DEV, fail-closed in PROD (the helper itself returns false on no-secret and is
// policy-agnostic). Secret configured ⇒ header MUST match (timing-safe).
const checkInternalSecret = (
  providedHeader: string | string[] | undefined
): boolean => {
  // No secret configured: in DEV graceful-allow; in PROD fail-closed (caller handles 404).
  if (!isInternalSecretConfigured()) {
    return !IS_PRODUCTION_ENV();
  }
  return verifyInternalSecret(providedHeader);
};

// DECISION (nie usuwaj tego komentarza):
// BDX W2.3 (FROZEN-adjacent — dev-login mintuje MASTER_ADMIN): owinięty w
// `withRawSecretHandler({ failClosedMode: 'custom' })`. Tryb 'custom' = wrapper daje
// WYŁĄCZNIE timing/error-scaffold; CAŁA security-krytyczna kolejność preludium zostaje
// VERBATIM w `handle` i jest CELOWO niezgodna z wspólnym withPublicHandler:
//   (1) OPTIONS → 204 PIERWSZY (preflight nie niesie x-internal-secret),
//   (2) checkInternalSecret (env-aware: DEV graceful-allow / PROD fail-closed) → 404-mask
//       PRZED isAllowedOrigin — inaczej origin-reject (406) wyciekłby istnienie endpointu,
//   (3) env-gate (PROD → 404-mask, NIE 403 — bez side-channelu „secret OK ale env zły"),
//   (4) DOPIERO potem isAllowedOrigin/setCORS + CQRS HTTPRequestHandlerMiddleware.
// Owinięcie tej kolejności wspólnym preludium (CORS-first) ZŁAMAŁOBY 404-mask, więc
// rdzeń zostaje surowy — zgodnie z FROZEN-regułą „lepiej surowy handler niż złamany auth".
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
        const { email } = data as { email?: string };
        if (!email || typeof email !== 'string' || !email.includes('@')) {
          return { __isValid: false, email: 'invalid email' };
        }
        return { __isValid: true };
      },
      businessLogic: async body => {
        // DECISION (nie usuwaj tego komentarza):
        // Lowercase normalization na wejsciu — isAdminEmail (admin.utils.api.ts:42)
        // sam normalizuje, ale Prisma findUnique({where:{email}}) jest case-sensitive.
        // Bez normalizacji "Test-Admin@..." utworzylby duplikat rekord obok seeded
        // "test-admin@..." z roznymi rolami. Single canonical form na wszystkich
        // sciezkach DB + comparison.
        const email = body.email.trim().toLowerCase();

        // DECISION (nie usuwaj tego komentarza):
        // withoutRole (dev-only, query param) — tworzy SWIEZEGO usera BEZ
        // stylist_account I BEZ client_account, odzwierciedlajac realny stan
        // PO signup a PRZED onboardingiem (Better Auth databaseHooks tworzy User
        // bez relacji account; onboarding wybiera role + zaklada konto). Seeded
        // test-stylist jest juz POST-onboarding, wiec e2e funnel-prefill (spec 15)
        // nie ma jak odtworzyc stanu "oba konta null" — ten flag to umozliwia.
        // Onboarding-guard (DashboardPage.useOnboardingGuard) routuje na
        // /app/onboarding gdy stylist_account===null && client_account===null &&
        // role!=='admin'; rola STYLIST_ROLE + account_type CLIENT (nizej) spelnia
        // ten warunek (useAppRole: isAdmin=false, isStylist=false → role='client').
        //
        // Query param (NIE body DTO) — zero zmian w kernelu (USER_DTO_API_V1.DEV_LOGIN).
        // Branch dziala TYLKO dla NOWEGO usera; istniejacy (np. ponowny run z tym
        // samym mailem) nie jest nigdy downgradowany. Cala sciezka i tak jest za
        // dev-gate (IS_DEVELOPMENT_ENV + INTERNAL_SHARED_SECRET + CORS) — zero
        // wplywu na prod. req w scope przez domkniecie (handler param).
        const wantsRolelessAccount =
          (Array.isArray(req.query.withoutRole)
            ? req.query.withoutRole[0]
            : req.query.withoutRole) === 'true';

        try {
          // Quick login „Test Client": przywroc klientke jednorolowa, zanim
          // sesja ja pokaze (dlaczego przy logowaniu, a nie tylko w seedzie:
          // DECISION przy seedTestClient_IO).
          if (email === TEST_USERS_CONFIG.CLIENT.email) {
            await seedTestClient_IO();
          }

          // Find or create user (mirrors Better Auth databaseHooks.user.create)
          let user = await DB_CLIENT.use.user.findUnique({
            where: { email },
            include: { stylist_account: true, client_account: true },
          });

          const isNewUser = !user;

          // DECISION (nie usuwaj tego komentarza):
          // Role assignment dla dev-login (oba branche: create I existing):
          //   1. Admin allow-list (MASTER_ADMIN_EMAIL env) → MASTER_ADMIN
          //   2. Test admin email (TEST_USERS_CONFIG.ADMIN) → MASTER_ADMIN
          //   3. Pozostali → STYLIST_ROLE (legacy backward-compat dla smoke tests)
          // Bez tego dev-login dla MASTER_ADMIN_EMAIL = STYLIST_ROLE bug
          // (admin gates fired even gdy session OK — design-lead retro 2026-05-26).
          const intendedRoleId:
            | typeof SystemRoleId.MASTER_ADMIN
            | typeof SystemRoleId.STYLIST_ROLE =
            isAdminEmail(email) || email === TEST_USERS_CONFIG.ADMIN.email
              ? SystemRoleId.MASTER_ADMIN
              : SystemRoleId.STYLIST_ROLE;

          if (!user && wantsRolelessAccount) {
            // DECISION (nie usuwaj tego komentarza):
            // Role-less swiezy user (patrz blok DECISION o withoutRole wyzej):
            // BEZ stylist_account I BEZ client_account → onboarding-eligible.
            // role_id jest NOT NULL — STYLIST_ROLE jako benign default (ta sama
            // wartosc co intendedRoleId dla nie-adminow); account_type=CLIENT
            // (jawnie = schema default), wiec useAppRole liczy role='client'
            // (NIE admin), a guard widzi oba konta null i routuje na onboarding.
            // is_active=true → deriveAccountRecoveryState='active' (brak bounce na
            // /app/recover). Mail unikalny per run, wiec ten branch raz na rekord.
            user = await DB_CLIENT.use.user.create({
              data: {
                email,
                role_id: SystemRoleId.STYLIST_ROLE,
                account_type: AccountTypeValue.CLIENT,
                is_active: true,
                // Konta dev-login są z założenia „wpuszczone" bez dowodu maila;
                // stempel trzyma je w tym samym kształcie co konta z magic-linka,
                // dzięki czemu logowanie Google na tym samym adresie linkuje się
                // zamiast odbijać `account_not_linked`.
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
            // DECISION (nie usuwaj tego komentarza):
            // QA admin-user-mgmt-3: reconcile MASTER_ADMIN role na ISTNIEJACYM userze.
            // Wczesniej rola byla stemplowana TYLKO w branchu create — jesli seeded
            // admin (MASTER_ADMIN_EMAIL / TEST_USERS_CONFIG.ADMIN) zdryfowal do
            // role_stylist (np. onboarding-downgrade albo delete+recreate przez
            // rownolegly tester), dev-login zwracal STYLIST session, a
            // requireTargetNotProtected (role_id === MASTER_ADMIN) przestawal go
            // chronic przed cross-admin disable/delete. Mirror idempotent-repair
            // wzorca z admin-seeding.operations.ts (initializeMasterAdmin_IO L44-49,
            // seedTestUsers_IO L255-260) — trzeci sibling tego samego
            // find-or-create-with-role flow. Reconcile WYLACZNIE upward do
            // MASTER_ADMIN dla skonfigurowanych admin-maili; nie ruszamy nie-adminow
            // (zaden downgrade), bo legit user moze celowo trzymac inna role.
            // Dev-gated (cala sciezka za IS_DEVELOPMENT_ENV) — zero wplywu na prod,
            // gdzie admini powstaja z env allow-list przy Better Auth signup.
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
