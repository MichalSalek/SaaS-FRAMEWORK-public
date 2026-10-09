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
          // Adres pochodzi z operatorskiej allow-listy (MASTER_ADMIN_EMAIL), więc
          // własność skrzynki jest dana z definicji — stempel zgodny z resztą
          // seedów. Bez niego konto admina zostaje „lokalnie niezweryfikowane" i
          // Better Auth odmawia podpięcia do niego logowania Google
          // (`account_not_linked`, incydent 2026-08-17).
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
        // AKTYWNA ROLA, nie samo posiadanie konta, decyduje o ekranie konta i szynie
        // (SSOT: main `application/policies/account-surface.policy.ts`), a kolumna ma
        // default CLIENT — wiec bez tej linii testowa STYLISTKA logowala sie w trybie
        // klientki: bez wizytowki, bez planu, bez preferencji e-mail. Sciezka demo
        // (demo-content-seeding.accounts) i sciezka admina stempluja to od zawsze;
        // te dwa konta zostaly w tyle.
        account_type: AccountTypeValue.STYLIST,
        name: stylistConfig.display_name,
        emailVerified: true,
      },
    });
    results.push('Test stylist created');
  } else {
    // Naprawa dryfu obejmuje ROLE SYSTEMOWA I ROLE AKTYWNA. Samo dodanie
    // `account_type` do galezi tworzacej nie leczy niczego: konto testowe ISTNIEJE
    // juz w kazdej bazie deweloperskiej i na stagingu, wiec to wlasnie tam siedzi
    // opisany defekt (stylistka w trybie klientki) i tam zostalby na zawsze.
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
      // Raport wymienia to, co NAPRAWDE dryfowalo — trojkat mowil „role" takze
      // wtedy, gdy rozjechaly sie OBA pola, wiec log seeda gubil polowe faktu.
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
    // Plan TEZ jest stanem zaseedowanym (galaz `create` ponizej go ustawia), a
    // testy API legalnie go zmieniaja — bez tego warunku podniesiony plan zostawal
    // na koncie na zawsze i kolejne przebiegi mierzyly inne limity niz zakladaly.
    // Parytet z wystawa demo, ktora pilnuje planu od poczatku.
    existingAccount.pricing_plan !== stylistConfig.pricing_plan
  ) {
    // DECISION (nie usuwaj tego komentarza):
    // Idempotent repair of the seeded test stylist's PUBLIC VISIBILITY state.
    // The public surface (get-stylist-profile, increment-view, gallery-explore,
    // og-meta) is intentionally ACTIVE-only — EXPIRING/EXPIRED/NOT_ACTIVE 404s by
    // design (anti-oracle parity, see account-profile.operations.ts). Re-test runs
    // (testy-api / smoke) can drift this account into EXPIRING via the legitimate
    // account-expiry interceptor (e.g. a temporarily-set expiration date), which
    // then breaks ACCOUNT_GET_PUBLIC_PROFILE + INCREMENT_VIEW_HAPPY_PATH smoke
    // tests that rely on it being publicly reachable. We re-pin it to the
    // seed-intended ACTIVE/PAID/no-expiration state on every seed. Scope is the
    // *.example.com test stylist ONLY — never real users — so this is test-infra
    // self-healing, not a production status mutation.
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
  // DECISION (nie usuwaj tego komentarza):
  // Test admin uzywany do quick-login (LoginPage tile) + Playwright design sessions.
  // Hardcoded MASTER_ADMIN role tutaj, bo to seed test usera, NIE produkcyjnego admina.
  // initializeMasterAdmin_IO obsluguje produkcyjnych adminow via env var.
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
 * Idempotent; returns what it did, one entry per step, for the seed log.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Wolane z DWOCH miejsc: seedTestUsers_IO (start backendu) i dev-login dla
 * TEST_USERS_CONFIG.CLIENT (quick login). Sam seed startowy nie wystarcza, bo
 * smoke `USER_ONBOARD_IDEMPOTENT` (tests/smoke/user.smoke.ts) celowo wola
 * onboard-stylist tokenem TEJ klientki i zostawia jej StylistAccount bez planu,
 * a smoke biegnie PO seedzie (RUN_SMOKE_TESTS_ON_STARTUP w dev) i recznie w
 * kazdej chwili. Bramka planu (useOnboardingPlanGuard) wyrzucala wtedy kazda
 * trase „Test Client" na /app/onboarding z copy stylistki (S122). Naprawa przy
 * logowaniu przywraca stan zanim ktokolwiek go zobaczy; smoke i tak zaklada
 * klientke jednorolowa, a onboard-stylist przyjmuje 200 i 201.
 * Zakres: WYLACZNIE adres *.example.com z konfiguracji testowej, nigdy prawdziwy
 * uzytkownik; dev-login stoi za IS_DEVELOPMENT_ENV + INTERNAL_SHARED_SECRET.
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
        // Zgodne z defaultem kolumny, ale stemplujemy JAWNIE: rola aktywna jest
        // faktem domenowym, a nie czyms, co ma wynikac z wartosci domyslnej.
        account_type: AccountTypeValue.CLIENT,
        emailVerified: true,
      },
    });
    results.push('Test client created');
  } else {
    // Jak wyzej — rola aktywna tez jest stanem zaseedowanym.
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
      // Ta galaz naprawia role I typ konta naraz, wiec komunikat wymienia oba —
      // „role fixed" bylo prawda tylko w polowie przypadkow, ktore tu wpadaja.
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
