import { DB_CLIENT } from '@app/db/db.client';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import {
  PaymentStatusValue,
  AccountStatusValue,
  AccountTypeValue,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { isAccountActive } from '@domain/account/account.config';
import { DEMO_STYLIST_PROFILE } from './demo-content-seeding.config';

/**
 * Konta demo (user + stylist/client account) — find-or-create + self-healing
 * pol krytycznych dla widocznosci wystawy. Czesc seedDemoContent_IO
 * (demo-content-seeding.operations.ts — patrz DECISION tamze).
 */
// Return type inferowany z Prisma (kernel-DTO maja zawezone unions — role_id,
// email_preferences — niekompatybilne z surowymi typami klienta Prisma).
export const ensureDemoAccounts_IO = async (results: string[]) => {
  // ── Demo stylist: user + stylist account ─────────────────────────────────
  const stylistConfig = TEST_USERS_CONFIG.DEMO_STYLIST;
  let stylistUser = await DB_CLIENT.use.user.findUnique({
    where: { email: stylistConfig.email },
  });

  if (!stylistUser) {
    stylistUser = await DB_CLIENT.use.user.create({
      data: {
        email: stylistConfig.email,
        name: stylistConfig.display_name,
        role_id: SystemRoleId.STYLIST_ROLE,
        account_type: AccountTypeValue.STYLIST,
        emailVerified: true,
      },
    });
    results.push('Demo stylist created');
  }

  let stylistAccount = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { created_by_user_id: stylistUser.id },
  });

  if (!stylistAccount) {
    stylistAccount = await DB_CLIENT.use.stylistAccount.create({
      data: {
        created_by_user_id: stylistUser.id,
        display_name: stylistConfig.display_name,
        pricing_plan: PricingPlanValue.STUDIO,
        payment_status: PaymentStatusValue.PAID,
        account_status: AccountStatusValue.ACTIVE,
        ...DEMO_STYLIST_PROFILE,
      },
    });
    results.push('Demo stylist account created');
  } else if (
    !isAccountActive(stylistAccount.account_status) ||
    stylistAccount.payment_status !== PaymentStatusValue.PAID ||
    stylistAccount.pricing_plan !== PricingPlanValue.STUDIO ||
    stylistAccount.account_expiration_date !== null
  ) {
    // Self-healing tylko pol krytycznych dla widocznosci wystawy (plan/status);
    // pola tekstowe profilu celowo NIE sa re-pinowane (reczne edycje w demo zostaja).
    stylistAccount = await DB_CLIENT.use.stylistAccount.update({
      where: { created_by_user_id: stylistUser.id },
      data: {
        pricing_plan: PricingPlanValue.STUDIO,
        payment_status: PaymentStatusValue.PAID,
        account_status: AccountStatusValue.ACTIVE,
        account_expiration_date: null,
      },
    });
    results.push('Demo stylist account re-pinned (STUDIO/PAID/ACTIVE)');
  }

  // S111 (2026-09-14): pola dodane PO pierwszym seedzie demo-stylistki nie mają
  // ścieżki backfillu w gałęzi create() powyżej dla już istniejących instalacji —
  // self-heal WYŁĄCZNIE brakujących wartości (nigdy nie nadpisuje ręcznej edycji
  // w demo), parytet z plan/status powyżej. plan_selected_at pilnuje, żeby demo
  // nigdy nie odbiło się do ekranu wyboru planu.
  if (
    stylistAccount.phone === null ||
    stylistAccount.website === null ||
    stylistAccount.brand_accent_color === null ||
    stylistAccount.plan_selected_at === null
  ) {
    stylistAccount = await DB_CLIENT.use.stylistAccount.update({
      where: { created_by_user_id: stylistUser.id },
      data: {
        phone: stylistAccount.phone ?? DEMO_STYLIST_PROFILE.phone,
        website: stylistAccount.website ?? DEMO_STYLIST_PROFILE.website,
        brand_accent_color:
          stylistAccount.brand_accent_color ??
          DEMO_STYLIST_PROFILE.brand_accent_color,
        plan_selected_at: stylistAccount.plan_selected_at ?? new Date(),
      },
    });
    results.push(
      'Demo stylist profile backfilled (phone/website/brand/plan_selected_at)'
    );
  }

  // ── Demo client: user + client account (z kontaktem) ─────────────────────
  const clientConfig = TEST_USERS_CONFIG.DEMO_CLIENT;
  let clientUser = await DB_CLIENT.use.user.findUnique({
    where: { email: clientConfig.email },
  });

  if (!clientUser) {
    clientUser = await DB_CLIENT.use.user.create({
      data: {
        email: clientConfig.email,
        name: clientConfig.display_name,
        role_id: SystemRoleId.CLIENT_ROLE,
        account_type: AccountTypeValue.CLIENT,
        emailVerified: true,
      },
    });
    results.push('Demo client created');
  }

  // S120: aktywna rola konta demo bywa przestawiona ręcznie w QA (przełącznik
  // roli), a wtedy ekrany klientki wpadają w onboarding stylistki. Seed
  // przywraca rolę, bo stan po seedzie ma być zawsze ten sam.
  if (
    clientUser.role_id !== SystemRoleId.CLIENT_ROLE ||
    clientUser.account_type !== AccountTypeValue.CLIENT
  ) {
    clientUser = await DB_CLIENT.use.user.update({
      where: { id: clientUser.id },
      data: {
        role_id: SystemRoleId.CLIENT_ROLE,
        account_type: AccountTypeValue.CLIENT,
      },
    });
    results.push('Demo client role restored');
  }

  // Konto demo klientki ma być JEDNOROLOWE. Klik w „przełącz na tryb stylistki”
  // podczas QA dorabia jej pusty StylistAccount bez planu, a wtedy bramka planu
  // wyrzuca każdy ekran klientki na onboarding (S120).
  const strayStylist = await DB_CLIENT.use.stylistAccount.findFirst({
    where: { created_by_user_id: clientUser.id },
  });
  if (strayStylist) {
    await DB_CLIENT.use.stylistAccount.delete({
      where: { account_id: strayStylist.account_id },
    });
    results.push('Demo client stray stylist account removed');
  }

  let clientAccount = await DB_CLIENT.use.clientAccount.findUnique({
    where: { created_by_user_id: clientUser.id },
  });

  if (!clientAccount) {
    clientAccount = await DB_CLIENT.use.clientAccount.create({
      data: {
        created_by_user_id: clientUser.id,
        contact_phone: '+48 512 345 678',
        contact_email: clientConfig.email,
      },
    });
    results.push('Demo client account created');
  }

  return { stylistUser, stylistAccount, clientUser, clientAccount };
};
