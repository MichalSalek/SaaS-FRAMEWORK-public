import { DB_CLIENT } from '@app/db/db.client';
import { ENV_VARS } from '@app/environment/environment.config';
import { getAdminEmails } from '@app/admin/admin.utils.api';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import {
  PaymentStatusValue,
  AccountStatusValue,
  AccountTypeValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import {
  defaultNewMasterAdminSettings,
  isAccountActive,
} from '@domain/account/account.config';

/**
 * Initialize Master Admin(s) — supports comma-separated MASTER_ADMIN_EMAIL env var
 * Used by: instrumentation.ts (auto-seed) + endpoint (legacy fallback)
 */
export const initializeMasterAdmin_IO = async (): Promise<{
  success: boolean;
  message: string;
  adminUserId: string | null;
}> => {
  const adminEmails = getAdminEmails();

  if (adminEmails.length === 0) {
    return {
      success: false,
      message: 'MASTER_ADMIN_EMAIL not configured',
      adminUserId: null,
    };
  }

  const results: string[] = [];
  let firstAdminUserId: string | null = null;

  for (const email of adminEmails) {
    const existingAdmin = await DB_CLIENT.use.user.findUnique({
      where: { email },
    });

    if (existingAdmin) {
      if (!firstAdminUserId) {
        firstAdminUserId = existingAdmin.id;
      }
      if (existingAdmin.role_id !== SystemRoleId.MASTER_ADMIN) {
        await DB_CLIENT.use.user.update({
          where: { id: existingAdmin.id },
          data: { role_id: SystemRoleId.MASTER_ADMIN },
        });
        results.push(`${email}: role updated`);
      } else {
        results.push(`${email}: exists`);
      }
    } else {
      const newAdmin = await DB_CLIENT.use.user.create({
        data: {
          email,
          role_id: SystemRoleId.MASTER_ADMIN,
          name: 'MASTER ADMIN',
          account_type: AccountTypeValue.STYLIST,
          // The address comes from the operator allow-list (MASTER_ADMIN_EMAIL), so mailbox
          // ownership is given by definition; the stamp matches the other seeds. Without it the
          // admin account stays "locally unverified" and Better Auth refuses to link Google
          // sign-in to it (`account_not_linked`).
          emailVerified: true,
          stylist_account: {
            create: defaultNewMasterAdminSettings,
          },
        },
      });
      if (!firstAdminUserId) {
        firstAdminUserId = newAdmin.id;
      }
      results.push(`${email}: created`);
    }
  }

  return {
    success: true,
    message: results.join(', '),
    adminUserId: firstAdminUserId,
  };
};

/**
 * Seed test users for smoke tests
 * Runs in DEVELOPMENT or when RUN_SMOKE_TESTS_ON_STARTUP=true
 */
export const seedTestUsers_IO = async (): Promise<{
  success: boolean;
  message: string;
}> => {
  // Only in development or when smoke tests are enabled
  if (
    ENV_VARS.NODE_ENV_MANUAL !== 'DEVELOPMENT' &&
    !ENV_VARS.RUN_SMOKE_TESTS_ON_STARTUP
  ) {
    return {
      success: true,
      message: 'Skipped (not development, smoke tests disabled)',
    };
  }

  const results: string[] = [];

  // 1. Seed test stylist
  const stylistConfig = TEST_USERS_CONFIG.STYLIST;
  let stylistUser = await DB_CLIENT.use.user.findUnique({
    where: { email: stylistConfig.email },
  });

  if (!stylistUser) {
    stylistUser = await DB_CLIENT.use.user.create({
      data: {
        email: stylistConfig.email,
        role_id: SystemRoleId.STYLIST_ROLE,
        // The ACTIVE ROLE, not merely owning an account, decides the account screen and rail
        // (SSOT: main `application/policies/account-surface.policy.ts`), and the column
        // defaults to CLIENT: without this line the test STYLIST would log in as a client, with
        // no profile card, plan or e-mail preferences. The demo path
        // (demo-content-seeding.accounts) and the admin path stamp it as well.
        account_type: AccountTypeValue.STYLIST,
        name: stylistConfig.display_name,
        emailVerified: true,
      },
    });
    results.push('Test stylist created');
  } else {
    // The drift repair covers the SYSTEM ROLE AND the ACTIVE ROLE. Adding `account_type` to
    // the create branch alone heals nothing: the test account already EXISTS in every dev and
    // staging database, which is where the defect (stylist in client mode) lives.
    const roleDrift = stylistUser.role_id !== SystemRoleId.STYLIST_ROLE;
    const surfaceDrift = stylistUser.account_type !== AccountTypeValue.STYLIST;
    if (roleDrift || surfaceDrift) {
      await DB_CLIENT.use.user.update({
        where: { id: stylistUser.id },
        data: {
          role_id: SystemRoleId.STYLIST_ROLE,
          account_type: AccountTypeValue.STYLIST,
        },
      });
      // The report names what REALLY drifted: it must not say "role" when BOTH fields
      // diverged, or the seed log loses half the fact.
      const fixed = [
        roleDrift ? 'role' : null,
        surfaceDrift ? 'account_type' : null,
      ]
        .filter((label): label is string => label !== null)
        .join(' + ');
      results.push(`Test stylist ${fixed} fixed`);
    } else {
      results.push('Test stylist exists');
    }
  }

  // 2. Ensure StylistAccount exists
  const existingAccount = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { created_by_user_id: stylistUser.id },
  });

  if (!existingAccount) {
    await DB_CLIENT.use.stylistAccount.create({
      data: {
        created_by_user_id: stylistUser.id,
        display_name: stylistConfig.display_name,
        pricing_plan: stylistConfig.pricing_plan,
        payment_status: PaymentStatusValue.PAID,
        account_status: AccountStatusValue.ACTIVE,
      },
    });
    results.push('Test stylist account created');
  } else if (
    !isAccountActive(existingAccount.account_status) ||
    existingAccount.payment_status !== PaymentStatusValue.PAID ||
    existingAccount.account_expiration_date !== null ||
    // The plan is seeded state TOO (the `create` branch below sets it) and API tests
    // legitimately change it; without this condition a raised plan stayed on the account and
    // later runs measured different limits than they assumed. Parity with the demo showcase,
    // which pins the plan.
    existingAccount.pricing_plan !== stylistConfig.pricing_plan
  ) {
    // DECISION: repair of the *.example.com test stylist only, safe to re-run. Public surfaces are
    // ACTIVE-only by design, and test runs legitimately drift this account (expiry, plan change),
    // which broke the public-profile and increment-view smoke tests. Every seed re-pins it to
    // ACTIVE/PAID/no expiry/seeded plan; real users are never touched.
    await DB_CLIENT.use.stylistAccount.update({
      where: { created_by_user_id: stylistUser.id },
      data: {
        payment_status: PaymentStatusValue.PAID,
        account_status: AccountStatusValue.ACTIVE,
        account_expiration_date: null,
        pricing_plan: stylistConfig.pricing_plan,
      },
    });
    results.push('Test stylist account re-pinned to ACTIVE (drift repaired)');
  } else {
    results.push('Test stylist account exists');
  }

  // 3-4. Seed test client (user + canonical single-role client state)
  results.push(...(await seedTestClient_IO()));

  // 5. Seed test admin (MASTER_ADMIN — independent of MASTER_ADMIN_EMAIL env).
  // Test admin for quick login and Playwright sessions; production admins come from
  // initializeMasterAdmin_IO via env, so the hardcoded MASTER_ADMIN role here is test-only.
  const adminConfig = TEST_USERS_CONFIG.ADMIN;
  let adminUser = await DB_CLIENT.use.user.findUnique({
    where: { email: adminConfig.email },
  });

  if (!adminUser) {
    adminUser = await DB_CLIENT.use.user.create({
      data: {
        email: adminConfig.email,
        role_id: SystemRoleId.MASTER_ADMIN,
        name: adminConfig.display_name,
        account_type: AccountTypeValue.STYLIST,
        emailVerified: true,
        stylist_account: {
          create: defaultNewMasterAdminSettings,
        },
      },
    });
    results.push('Test admin created');
  } else if (adminUser.role_id !== SystemRoleId.MASTER_ADMIN) {
    await DB_CLIENT.use.user.update({
      where: { id: adminUser.id },
      data: { role_id: SystemRoleId.MASTER_ADMIN },
    });
    results.push('Test admin role fixed');
  } else {
    results.push('Test admin exists');
  }

  return {
    success: true,
    message: results.join(', '),
  };
};

/**
 * Seed (or repair) the smoke-test CLIENT into the state every consumer assumes:
 * CLIENT_ROLE, active role CLIENT, a ClientAccount and NO StylistAccount.
 * Safe to re-run (each step checks before writing); returns what it did, one entry per step,
 * for the seed log.
 *
 * DECISION: called from two places, the backend boot seed and dev-login for
 * TEST_USERS_CONFIG.CLIENT. The boot seed alone is not enough: smoke USER_ONBOARD_IDEMPOTENT
 * (tests/smoke/user.smoke.ts) onboards this client as a stylist with her own token and leaves a
 * plan-less StylistAccount, so every "Test Client" route was sent to /app/onboarding. Repairing at
 * login restores the state before anyone sees it. Scope: the *.example.com test address only;
 * dev-login is behind IS_DEVELOPMENT_ENV + INTERNAL_SHARED_SECRET.
 */
export const seedTestClient_IO = async (): Promise<string[]> => {
  const results: string[] = [];

  // 3. Seed test client
  const clientConfig = TEST_USERS_CONFIG.CLIENT;
  let clientUser = await DB_CLIENT.use.user.findUnique({
    where: { email: clientConfig.email },
  });

  if (!clientUser) {
    clientUser = await DB_CLIENT.use.user.create({
      data: {
        email: clientConfig.email,
        role_id: SystemRoleId.CLIENT_ROLE,
        // Matches the column default, but stamped EXPLICITLY: the active role is a domain fact,
        // not something to derive from a default value.
        account_type: AccountTypeValue.CLIENT,
        emailVerified: true,
      },
    });
    results.push('Test client created');
  } else {
    // As above: the active role is seeded state too.
    if (
      clientUser.role_id !== SystemRoleId.CLIENT_ROLE ||
      clientUser.account_type !== AccountTypeValue.CLIENT
    ) {
      await DB_CLIENT.use.user.update({
        where: { id: clientUser.id },
        data: {
          role_id: SystemRoleId.CLIENT_ROLE,
          account_type: AccountTypeValue.CLIENT,
        },
      });
      // This branch repairs the role AND the account type at once, so the message names both;
      // "role fixed" was true in only half of the cases that land here.
      results.push('Test client role/account_type fixed');
    } else {
      results.push('Test client exists');
    }
  }

  // 3.1. Cleanup orphaned stylist_account (legacy data from previous tests)
  // Business rule: CLIENT_ROLE should only have client_account, not stylist_account
  const orphanedStylistAccount = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { created_by_user_id: clientUser.id },
  });

  if (orphanedStylistAccount) {
    await DB_CLIENT.use.stylistAccount.delete({
      where: { created_by_user_id: clientUser.id },
    });
    results.push('Orphaned stylist_account removed from CLIENT user');
  }

  // 4. Ensure ClientAccount exists
  const existingClientAccount = await DB_CLIENT.use.clientAccount.findUnique({
    where: { created_by_user_id: clientUser.id },
  });

  if (!existingClientAccount) {
    await DB_CLIENT.use.clientAccount.create({
      data: {
        created_by_user_id: clientUser.id,
      },
    });
    results.push('Test client account created');
  } else {
    results.push('Test client account exists');
  }

  return results;
};
