import { invitationToStaffDTO } from '../salon-invitation.mapper';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type {
  SalonStaffNotFoundError,
  SalonStaffLimitReachedError,
} from '@kernel/domain/salon-staff/salon-staff-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import {
  mapStaffMemberToDTO,
  liveStaffSeatWhere,
} from '@domain/salon-staff/salon-staff.utils';
import type { StaffMemberDTO } from '@kernel/models/salon-staff/salon-staff.dto';

export const getAllStaffMembers_IO = async ({
  accountId,
  // DECISION: pricingPlan is accepted but unused (named `_pricingPlan` for `noUnusedParameters`). It stays in the
  // parameter type for caller-shape parity: the list handler passes { accountId, pricingPlan } as a direct object literal
  // and TS excess-property checks would reject a narrower type. The plan gate was removed: list is a read-only,
  // capacity-NEUTRAL op already scoped to the caller's own salon (stylist_account_id from the session), and a STUDIO/SCALE
  // owner downgraded to FREE/PRO must still be able to discover orphan staff rows to remove them.
  // SalonStaffLimitReachedError stays in the union for signature parity with sibling ops and the shared error-mapper case.
  pricingPlan: _pricingPlan,
}: {
  accountId: string;
  pricingPlan: PricingPlan;
}): Promise<
  OperationResult<
    { staff: StaffMemberDTO[] },
    SalonStaffLimitReachedError | DatabaseError
  >
> => {
  try {
    const staffMembers = await DB_CLIENT.use.staffMember.findMany({
      // The list MUST have the same basis as the quota count, hence the shared liveStaffSeatWhere (see salon-staff.utils.ts).
      // The roster shows exactly the seats that count toward the plan limit; a person with a dead account STAYS on the
      // list as "Konto nieaktywne" (PII mask in mapStaffMemberToDTO by `user.is_active`) so the owner sees the occupied seat
      // and can free it.
      where: liveStaffSeatWhere(accountId),
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
              select: {
                account_id: true,
                account_status: true,
                display_name: true,
                business_name: true,
              },
            },
          },
        },
      },
      // Stable ordering — without it Postgres returns heap/scan order, so the
      // staff list reshuffles in the UI after any invite/permission-update +
      // query invalidation. invited_at asc (oldest-first) + id tie-break so rows
      // sharing a timestamp still order deterministically (repo tiebreaker convention).
      orderBy: [{ invited_at: 'asc' }, { id: 'asc' }],
      take: 200,
    });

    const invitations = await DB_CLIENT.use.salonInvitation.findMany({
      where: {
        salon_account_id: accountId,
        attached_user_id: null,
        declined_at: null,
        OR: [
          { accepted_at: { not: null } },
          { expires_at: { gt: new Date() } },
        ],
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return success({
      staff: [
        ...staffMembers.map(mapStaffMemberToDTO),
        ...invitations.map(invitationToStaffDTO),
      ],
    });
  } catch (error) {
    return databaseFailure('getAllStaffMembers', error);
  }
};

export const getStaffMemberById_IO = async ({
  staffId,
  accountId,
  // DECISION: pricingPlan is accepted but unused (named `_pricingPlan` for noUnusedParameters); it stays in the param
  // type for caller-shape parity (the [staffId] handler passes { staffId, accountId, pricingPlan } as a direct literal).
  // The plan gate was removed for the same reason as getAllStaffMembers: a read-only, capacity-NEUTRAL op already scoped
  // to the caller's own salon must stay accessible after a downgrade so an owner can discover orphan rows.
  // SalonStaffLimitReachedError stays in the union for signature parity.
  pricingPlan: _pricingPlan,
}: {
  staffId: string;
  accountId: string;
  pricingPlan: PricingPlan;
}): Promise<
  OperationResult<
    { staff: StaffMemberDTO },
    SalonStaffLimitReachedError | SalonStaffNotFoundError | DatabaseError
  >
> => {
  try {
    const targetStaff = await DB_CLIENT.use.staffMember.findFirst({
      // Same predicate as the list. Detail must not show a member the roster
      // (and the quota) no longer counts because her account is dead. Deleting a
      // row does not use this read (deleteMany by id), so the filter does not block the owner.
      where: { ...liveStaffSeatWhere(accountId), id: staffId },
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
              select: {
                account_id: true,
                account_status: true,
                display_name: true,
                business_name: true,
              },
            },
          },
        },
      },
    });

    if (!targetStaff) {
      return failure({ type: 'SALON_STAFF_NOT_FOUND', staffId });
    }

    return success({ staff: mapStaffMemberToDTO(targetStaff) });
  } catch (error) {
    return databaseFailure('getStaffMemberById', error);
  }
};
