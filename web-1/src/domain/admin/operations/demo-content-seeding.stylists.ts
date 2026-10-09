import { DB_CLIENT } from '@app/db/db.client';
import {
  PaymentStatusValue,
  AccountStatusValue,
  AccountTypeValue,
  StaffRoleValue,
  type PaymentStatus,
} from '@kernel/models/db_models.generated.dto';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { isAccountActive } from '@domain/account/account.config';
import { DEFAULT_PERMISSIONS_BY_ROLE } from '@kernel/domain/user-and-account/staff_accounts.config';
import { TIME } from '@kernel/application/constants.config';
import { DEMO_SALON_STAFF } from './demo-content-seeding.config';

/**
 * Konta-goście wystawy (Ola, Nina) + personel salonu Ani (Marta, Kasia) — part
 * of seedDemoContent_IO. DECISION-kontekst: demo-content-seeding.operations.ts.
 */

type GuestStylistProfile = Readonly<Record<string, string | undefined>>;

export const ensureGuestStylist_IO = async ({
  userConfig,
  profile,
  pricingPlan,
  paymentStatus = PaymentStatusValue.PAID,
  now,
  results,
}: {
  userConfig: { email: string; display_name: string };
  profile: GuestStylistProfile;
  pricingPlan: PricingPlan;
  /** Domyślnie PAID (plan płatny); konta FREE wystawy przekazują UNPAID. */
  paymentStatus?: PaymentStatus;
  now: Date;
  results: string[];
}) => {
  let user = await DB_CLIENT.use.user.findUnique({
    where: { email: userConfig.email },
  });
  if (!user) {
    user = await DB_CLIENT.use.user.create({
      data: {
        email: userConfig.email,
        name: userConfig.display_name,
        role_id: SystemRoleId.STYLIST_ROLE,
        account_type: AccountTypeValue.STYLIST,
        emailVerified: true,
      },
    });
    results.push(`Demo guest stylist created (${userConfig.display_name})`);
  }

  let account = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { created_by_user_id: user.id },
  });
  if (!account) {
    account = await DB_CLIENT.use.stylistAccount.create({
      data: {
        created_by_user_id: user.id,
        display_name: userConfig.display_name,
        pricing_plan: pricingPlan,
        payment_status: paymentStatus,
        account_status: AccountStatusValue.ACTIVE,
        plan_selected_at: now,
        ...profile,
      },
    });
    results.push(
      `Demo guest stylist account created (${userConfig.display_name})`
    );
  } else if (
    !isAccountActive(account.account_status) ||
    account.payment_status !== paymentStatus ||
    account.pricing_plan !== pricingPlan ||
    account.plan_selected_at === null ||
    account.account_expiration_date !== null
  ) {
    account = await DB_CLIENT.use.stylistAccount.update({
      where: { created_by_user_id: user.id },
      data: {
        pricing_plan: pricingPlan,
        payment_status: paymentStatus,
        account_status: AccountStatusValue.ACTIVE,
        plan_selected_at: account.plan_selected_at ?? now,
        account_expiration_date: null,
      },
    });
    results.push(`Demo guest stylist re-pinned (${userConfig.display_name})`);
  }

  return { user, account };
};

/**
 * Personel salonu Ani — mirror rzeczywistej ścieżki invite+accept
 * (inviteStaffMember_IO, salon-staff-management.operations.ts): każdy member
 * MUSI mieć własne konto stylistki (invite filtruje po `stylist_account: {isNot:
 * null}`), więc Marta i Kasia dostają minimalny FREE/UNPAID profil — nie są
 * klientkami produktu, są tylko właścicielkami slotu w rosterze Ani.
 */
export const ensureSalonStaff_IO = async ({
  ownerAccountId,
  now,
  results,
}: {
  ownerAccountId: string;
  now: Date;
  results: string[];
}): Promise<void> => {
  for (const staff of DEMO_SALON_STAFF) {
    let staffUser = await DB_CLIENT.use.user.findUnique({
      where: { email: staff.email },
    });
    if (!staffUser) {
      staffUser = await DB_CLIENT.use.user.create({
        data: {
          email: staff.email,
          name: staff.display_name,
          role_id: SystemRoleId.STYLIST_ROLE,
          account_type: AccountTypeValue.STYLIST,
          emailVerified: true,
        },
      });
      results.push(`Demo salon staff user created (${staff.display_name})`);
    }

    let staffAccount = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { created_by_user_id: staffUser.id },
    });
    if (!staffAccount) {
      staffAccount = await DB_CLIENT.use.stylistAccount.create({
        data: {
          created_by_user_id: staffUser.id,
          display_name: staff.display_name,
          pricing_plan: PricingPlanValue.FREE,
          payment_status: PaymentStatusValue.UNPAID,
          account_status: AccountStatusValue.ACTIVE,
          plan_selected_at: now,
        },
      });
    }

    const existingMembership = await DB_CLIENT.use.staffMember.findUnique({
      where: {
        stylist_account_id_user_id: {
          stylist_account_id: ownerAccountId,
          user_id: staffUser.id,
        },
      },
    });
    if (!existingMembership) {
      await DB_CLIENT.use.staffMember.create({
        data: {
          stylist_account_id: ownerAccountId,
          user_id: staffUser.id,
          role: StaffRoleValue.EMPLOYEE,
          permissions: [...DEFAULT_PERMISSIONS_BY_ROLE.EMPLOYEE],
          is_active: true,
          invited_at: new Date(now.getTime() - 60 * TIME.MS_PER_DAY),
          accepted_at: new Date(now.getTime() - 59 * TIME.MS_PER_DAY),
        },
      });
      results.push(
        `Demo salon staff membership created (${staff.display_name})`
      );
    } else if (!existingMembership.is_active) {
      await DB_CLIENT.use.staffMember.update({
        where: { id: existingMembership.id },
        data: { is_active: true },
      });
      results.push(`Demo salon staff re-activated (${staff.display_name})`);
    }
  }
};
