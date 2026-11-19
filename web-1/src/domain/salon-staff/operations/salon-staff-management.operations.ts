import { reconcileSalonDerivedPairingsAfterCommit_IO } from '@domain/pairing/salon-derived-cleanup.operations';
import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import {
  SALON_INVITATION_VALID_DAYS,
  SALON_INVITATIONS_PER_HOUR,
} from '../salon-invitation.config';
import { lockStylistAccount } from '@app/db/lock-rows';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  createInvitationToken,
  hashInvitationToken,
} from '../salon-invitation-token.service';
import { invitationToStaffDTO } from '../salon-invitation.mapper';
import type {
  SalonStaffNotFoundError,
  SalonStaffAlreadyExistsError,
  SalonStaffLimitReachedError,
  SalonStaffSelfInviteError,
} from '@kernel/domain/salon-staff/salon-staff-errors.types';
import type { ValidationError } from '@kernel/application/common-errors.types';
import {
  isUnlimitedLimit,
  PRICING_POLICY,
  UNLIMITED_LIMIT,
} from '@kernel/policies/pricing.policy';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  type StaffRole,
  type StaffPermission,
} from '@kernel/domain/user-and-account/staff_accounts.config';
import { StaffRoleValue } from '@kernel/models/db_models.generated.dto';
import {
  mapStaffMemberToDTO,
  liveStaffSeatWhere,
} from '@domain/salon-staff/salon-staff.utils';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';

// DECISION: e-mail invitations reserve seats without revealing account existence. Membership attaches only after
// acceptance and ordinary stylist onboarding. The salon row lock serializes invitation capacity and per-salon
// throttling against concurrent requests.
export const inviteStaffMember_IO = async ({
  email,
  role,
  accountId,
  pricingPlan: _pricingPlan,
}: {
  email: string;
  role: StaffRole;
  accountId: string;
  pricingPlan: PricingPlan;
}): Promise<
  OperationResult<
    { staff: StaffMemberDTO; invitationToken?: string },
    | SalonStaffLimitReachedError
    | SalonStaffSelfInviteError
    | SalonStaffAlreadyExistsError
    | ValidationError
    | DatabaseError
  >
> => {
  if (role !== 'EMPLOYEE') {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'role',
      message: 'Only the EMPLOYEE role can be invited',
    });
  }
  const normalizedEmail = email.trim().toLowerCase();
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, accountId);
      const owner = await tx.stylistAccount.findUnique({
        where: { account_id: accountId },
        select: {
          paid_staff_seats: true,
          pricing_plan: true,
          created_by_user: { select: { email: true } },
        },
      });
      if (!owner) {
        return databaseFailure('inviteStaffMember', new Error('Salon missing'));
      }
      const currentPlan = owner.pricing_plan;
      const currentPlanConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
      if (!PRICING_POLICY.utils.canUseStaffAccounts(currentPlanConfig)) {
        return failure({
          type: 'SALON_STAFF_LIMIT_REACHED',
          currentCount: 0,
          limit: 0,
          planType: currentPlan,
        });
      }
      if (owner.created_by_user?.email.toLowerCase() === normalizedEmail) {
        return failure({ type: 'SALON_STAFF_SELF_INVITE', accountId });
      }
      const now = new Date();
      const existing = await tx.salonInvitation.findFirst({
        where: {
          salon_account_id: accountId,
          email: normalizedEmail,
          declined_at: null,
          OR: [{ accepted_at: { not: null } }, { expires_at: { gt: now } }],
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      });
      if (existing) {
        return success({ staff: invitationToStaffDTO(existing) });
      }
      const members = await tx.staffMember.count({
        where: liveStaffSeatWhere(accountId),
      });
      const pending = await tx.salonInvitation.count({
        where: {
          salon_account_id: accountId,
          attached_user_id: null,
          declined_at: null,
          OR: [{ accepted_at: { not: null } }, { expires_at: { gt: now } }],
        },
      });
      const limit = isUnlimitedLimit(currentPlanConfig.max_staff_members)
        ? UNLIMITED_LIMIT
        : currentPlanConfig.max_staff_members + owner.paid_staff_seats;
      if (!isUnlimitedLimit(limit) && members + pending >= limit) {
        return failure({
          type: 'SALON_STAFF_LIMIT_REACHED',
          currentCount: members + pending,
          limit,
          planType: currentPlan,
        });
      }
      const recent = await tx.salonInvitation.count({
        where: {
          salon_account_id: accountId,
          created_at: { gt: new Date(now.getTime() - TIME.MS_PER_HOUR) },
        },
      });
      if (recent >= SALON_INVITATIONS_PER_HOUR) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'email',
          message: 'Invitation rate limit reached',
        });
      }
      const token = createInvitationToken();
      const invitation = await tx.salonInvitation.create({
        data: {
          salon_account_id: accountId,
          email: normalizedEmail,
          role,
          token_hash: hashInvitationToken(token),
          expires_at: new Date(
            now.getTime() + SALON_INVITATION_VALID_DAYS * TIME.MS_PER_DAY
          ),
        },
      });
      return success({
        staff: invitationToStaffDTO(invitation),
        invitationToken: token,
      });
    });
  } catch (error) {
    return databaseFailure('inviteStaffMember', error);
  }
};

export const updateStaffPermissions_IO = async ({
  staffId,
  accountId,
  pricingPlan,
  permissions,
  role,
}: {
  staffId: string;
  accountId: string;
  pricingPlan: PricingPlan;
  permissions?: StaffPermission[] | undefined;
  role?: StaffRole | undefined;
}): Promise<
  OperationResult<
    { staff: StaffMemberDTO },
    | SalonStaffLimitReachedError
    | SalonStaffNotFoundError
    | ValidationError
    | DatabaseError
  >
> => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricingPlan);
  if (!PRICING_POLICY.utils.canUseStaffAccounts(planConfig)) {
    return failure({
      type: 'SALON_STAFF_LIMIT_REACHED',
      currentCount: 0,
      limit: 0,
      planType: pricingPlan,
    });
  }

  // DECISION: defence-in-depth privilege-escalation guard, parallel to the salonStaffInvite / salonStaffUpdate
  // validator floor. The validator already rejects any `role` field on this endpoint, but this op-level reject of
  // OWNER is the last line of defence if a future caller bypasses it: a salon has exactly one OWNER (its creator,
  // StylistAccount.created_by_user_id), so reassigning OWNER via a staff update would grant
  // DEFAULT_PERMISSIONS_BY_ROLE.OWNER = all permissions and (frontend gates remove on !isOwner) make the escalated
  // row un-removable. Reject before touching the DB.
  if (role === StaffRoleValue.OWNER) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'role',
      message: 'Role OWNER cannot be assigned via staff update',
    });
  }

  const updateData: { permissions?: StaffPermission[]; role?: StaffRole } = {};
  if (permissions) {
    updateData.permissions = permissions;
  }
  if (role) {
    updateData.role = role;
  }

  if (Object.keys(updateData).length === 0) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'permissions|role',
      message: 'At least one field must be provided',
    });
  }

  // DD2-M2 r28: TOCTOU-safe atomic update — collapses prior findFirst+update window
  // where a concurrent owner-change between the check and the update could mutate
  // a staff row belonging to a different stylist_account_id. updateMany with
  // composite predicate is single-statement atomic; count===0 distinguishes
  // not-found from update-failure (Prisma error code path stays in catch).
  // Mirror dla removeStaffMember (M1 r28 pattern).
  // DD2-H7 r28: post-update findUnique z include user — mapStaffMemberToDTO
  // conditionally spreads user, response shape must include user dla DTO consistency.
  try {
    const result = await DB_CLIENT.use.staffMember.updateMany({
      where: { id: staffId, stylist_account_id: accountId },
      data: updateData,
    });
    if (result.count === 0) {
      return failure({ type: 'SALON_STAFF_NOT_FOUND', staffId });
    }
    const updatedStaff = await DB_CLIENT.use.staffMember.findUnique({
      where: { id: staffId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            avatar_url: true,
            is_active: true,
            stylist_account: {
              select: { display_name: true, business_name: true },
            },
          },
        },
      },
    });
    if (!updatedStaff) {
      // Race: row deleted between update and re-fetch — treat as not found.
      return failure({ type: 'SALON_STAFF_NOT_FOUND', staffId });
    }

    return success({ staff: mapStaffMemberToDTO(updatedStaff) });
  } catch (error) {
    return databaseFailure('updateStaffPermissions', error);
  }
};

export const removeStaffMember_IO = async ({
  staffId,
  accountId,
  // DECISION: pricingPlan is accepted but unused (named `_pricingPlan` so `noUnusedParameters` stays satisfied). It
  // stays in the parameter type for caller-shape parity: the delete handler passes { staffId, accountId, pricingPlan }
  // as a direct object literal, and TS excess-property checks would reject a narrower type. The plan gate that read it
  // was removed on purpose (see the block below).
  pricingPlan: _pricingPlan,
}: {
  staffId: string;
  accountId: string;
  pricingPlan: PricingPlan;
}): Promise<
  OperationResult<
    { success: true },
    SalonStaffLimitReachedError | SalonStaffNotFoundError | DatabaseError
  >
> => {
  // TOCTOU-safe atomic delete: deleteMany with a composite predicate is one atomic statement, replacing the earlier
  // findFirst+delete window where a concurrent owner change could remove a staff row of another stylist_account_id. A
  // delete failure still lands in the catch (Prisma error code path).
  //
  // DECISION: idempotent. count===0 (row already removed: double tap on "Zwolnij miejsce", two devices, HTTP retry; OR an
  // id outside the own salon) = the SAME success. The target state ("this seat is not in my roster") is reached, and telling
  // "foreign" from "already removed" by the composite WHERE is impossible without a second read; a uniform answer reveals
  // no foreign rows (no oracle). SALON_STAFF_NOT_FOUND on count===0 used to give an error toast AFTER a successful
  // removal on every retry. SalonStaffNotFoundError stays in the union for signature parity with sibling operations.
  try {
    await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, accountId);
      const member = await tx.staffMember.findFirst({
        where: { id: staffId, stylist_account_id: accountId },
        select: { user_id: true },
      });
      await tx.staffMember.deleteMany({
        where: { id: staffId, stylist_account_id: accountId },
      });
      await tx.salonInvitation.updateMany({
        where: {
          salon_account_id: accountId,
          OR: [
            { id: staffId },
            ...(member ? [{ attached_user_id: member.user_id }] : []),
          ],
        },
        data: { declined_at: new Date() },
      });
    });
    await reconcileSalonDerivedPairingsAfterCommit_IO(
      { salonAccountId: accountId },
      'removeStaffMember'
    );
    return success({ success: true });
  } catch (error) {
    return databaseFailure('removeStaffMember', error);
  }
};
