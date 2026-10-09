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
  // DECISION (nie usuwaj tego komentarza):
  // pricingPlan is intentionally accepted-but-unused (renamed to `_pricingPlan` so
  // `noUnusedParameters` stays satisfied). KEPT in the parameter type for caller-shape
  // parity — the list handler passes { accountId, pricingPlan } as a direct object
  // literal and TS excess-property checks would reject a narrower type. The plan-gate
  // that previously read it was removed: list is a read-only, capacity-NEUTRAL op
  // already scoped to the caller's own salon (stylist_account_id from session), and a
  // STUDIO/SCALE owner downgraded to FREE/PRO must still be able to DISCOVER orphan
  // staff rows to remove them. SalonStaffLimitReachedError stays in the union for
  // signature parity with the sibling ops and the shared error-mapper case.
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
      // Lista MUSI mieć tę samą podstawę co quota count — stąd wspólne liveStaffSeatWhere
      // (patrz DECISION w salon-staff.utils.ts). Roster pokazuje dokładnie te miejsca, które
      // liczą się do limitu planu; osoba z martwym kontem ZOSTAJE na liście jako „Konto
      // nieaktywne" (D1: maska PII w mapStaffMemberToDTO po `user.is_active`), żeby
      // właścicielka widziała zajęte miejsce i mogła je zwolnić.
      where: liveStaffSeatWhere(accountId),
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            is_active: true,
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

    return success({ staff: staffMembers.map(mapStaffMemberToDTO) });
  } catch (error) {
    return databaseFailure('getAllStaffMembers', error);
  }
};

export const getStaffMemberById_IO = async ({
  staffId,
  accountId,
  // DECISION (nie usuwaj tego komentarza):
  // pricingPlan accepted-but-unused (renamed `_pricingPlan` for noUnusedParameters);
  // KEPT in the param type for caller-shape parity (the [staffId] handler passes
  // { staffId, accountId, pricingPlan } as a direct literal). Plan-gate removed for the
  // same reason as getAllStaffMembers: read-only capacity-NEUTRAL op, already scoped to
  // the caller's own salon, must stay accessible post-downgrade so an owner can discover
  // orphan rows. SalonStaffLimitReachedError retained in the union for signature parity.
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
      // Ten sam warunek co lista — detal nie może pokazywać członkini, której roster
      // (i quota) już nie widzi, bo jej konto jest martwe. Usuwanie wiersza NIE przechodzi
      // przez ten odczyt (deleteMany po id), więc filtr niczego nie blokuje właścicielce.
      where: { ...liveStaffSeatWhere(accountId), id: staffId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            is_active: true,
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
