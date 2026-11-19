import { DB_CLIENT } from '@app/db/db.client';
import { lockStylistAccount } from '@app/db/lock-rows';
import {
  isProfileLinkReservedByOther,
  lockProfileLinkSlugs,
} from '@domain/account/profile-link-alias.operations';
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
import {
  DEMO_SALON_PROFILE,
  DEMO_SALON_STAFF,
} from './demo-content-seeding.config';
import { pruneDemoSalonRoster_IO } from './demo-content-seeding.cleanup';

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
 * Ania's salon staff, mirroring invite plus accept (inviteStaffMember_IO).
 * Each member needs her own stylist account (the invite filters on
 * `stylist_account: {isNot: null}`), so Marta and Kasia get a minimal
 * FREE/UNPAID profile. They hold a roster slot; they are not product clients.
 * Then prune the roster to the seed (pruneDemoSalonRoster_IO) and fill the
 * salon profile (ensureDemoSalonProfile_IO).
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
  const staffUserIds: string[] = [];
  const staffAccountIds: string[] = [];
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

    staffUserIds.push(staffUser.id);
    staffAccountIds.push(staffAccount.account_id);

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

  await pruneDemoSalonRoster_IO({
    ownerAccountId,
    staffUserIds,
    staffAccountIds,
    results,
  });
  await ensureDemoSalonProfile_IO({ ownerAccountId, results });
};

/**
 * Ania's salon profile: fills only empty fields (same as fillMissingProfile),
 * so a hand-edited dev setup is not overwritten. The salon address is set
 * only when nobody else holds it (the column is unique). The showcase is
 * created only when the salon has no work in it yet.
 */
export const ensureDemoSalonProfile_IO = async ({
  ownerAccountId,
  results,
}: {
  ownerAccountId: string;
  results: string[];
}): Promise<void> => {
  const updatedFields = await DB_CLIENT.use.$transaction(async tx => {
    if (!(await lockStylistAccount(tx, ownerAccountId))) {
      return null;
    }
    const owner = await tx.stylistAccount.findUnique({
      where: { account_id: ownerAccountId },
      select: {
        salon_profile_name: true,
        salon_vanity_url: true,
        salon_brand_accent_color: true,
      },
    });
    if (!owner) {
      return null;
    }
    if (owner.salon_vanity_url === null) {
      await lockProfileLinkSlugs(tx, 'SALON', [
        DEMO_SALON_PROFILE.salon_vanity_url,
      ]);
    }
    const slugTaken =
      owner.salon_vanity_url === null &&
      ((await tx.stylistAccount.findFirst({
        where: { salon_vanity_url: DEMO_SALON_PROFILE.salon_vanity_url },
        select: { account_id: true },
      })) !== null ||
        (await isProfileLinkReservedByOther(tx, {
          kind: 'SALON',
          slug: DEMO_SALON_PROFILE.salon_vanity_url,
          accountId: ownerAccountId,
        })));
    const data = {
      ...(owner.salon_profile_name === null
        ? { salon_profile_name: DEMO_SALON_PROFILE.salon_profile_name }
        : {}),
      ...(owner.salon_vanity_url === null && !slugTaken
        ? { salon_vanity_url: DEMO_SALON_PROFILE.salon_vanity_url }
        : {}),
      ...(owner.salon_brand_accent_color === null
        ? {
            salon_brand_accent_color:
              DEMO_SALON_PROFILE.salon_brand_accent_color,
          }
        : {}),
    };
    if (Object.keys(data).length > 0) {
      await tx.stylistAccount.update({
        where: { account_id: ownerAccountId },
        data,
      });
    }
    return Object.keys(data);
  });
  if (!updatedFields) {
    return;
  }
  if (updatedFields.length > 0) {
    results.push(`Demo salon profile filled (${updatedFields.join(', ')})`);
  }

  const showcaseCount = await DB_CLIENT.use.salonShowcaseWork.count({
    where: { salon_account_id: ownerAccountId },
  });
  if (showcaseCount > 0) {
    return;
  }
  const works = await DB_CLIENT.use.galleryRecord.findMany({
    where: {
      created_by_account_id: ownerAccountId,
      asset_url: { in: [...DEMO_SALON_PROFILE.showcase_asset_urls] },
    },
    select: { gallery_record_id: true },
  });
  if (works.length === 0) {
    return;
  }
  await DB_CLIENT.use.salonShowcaseWork.createMany({
    data: works.map(work => ({
      salon_account_id: ownerAccountId,
      gallery_record_id: work.gallery_record_id,
    })),
    skipDuplicates: true,
  });
  results.push(`Demo salon showcase created (${works.length} works)`);
};
