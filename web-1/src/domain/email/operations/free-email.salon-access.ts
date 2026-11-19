import type { Prisma } from '../../../prisma/js-client';
import { resolveEffectivePlans_IO } from '@app/pricing/effective-plan.resolver';

/** Persist access grants in the granting transaction; later revocation cannot restart Free tips. */
type SalonAccessTx = Pick<
  Prisma.TransactionClient,
  'staffMember' | 'freeEmailEnrollment'
>;
const finishFreeForMemberships_IO = async (
  tx: SalonAccessTx,
  where: Prisma.StaffMemberWhereInput,
  now: Date
): Promise<void> => {
  const members = await tx.staffMember.findMany({
    where: { ...where, is_active: true, accepted_at: { not: null } },
    select: { user_id: true },
    orderBy: { id: 'asc' },
    take: 10000,
  });
  if (members.length === 0) {
    return;
  }
  // This existing resolver owns salon expiry, owner liveness, paid plans and ACTIVE subscription.
  const plans = await resolveEffectivePlans_IO(
    members.map(member => ({ userId: member.user_id, ownPlan: 'FREE' })),
    tx
  );
  const paidUserIds = [...plans.entries()]
    .filter(([, plan]) => plan.effective_pricing_plan !== 'FREE')
    .map(([id]) => id);
  if (paidUserIds.length === 0) {
    return;
  }
  await tx.freeEmailEnrollment.updateMany({
    where: { userId: { in: paidUserIds }, status: 'active' },
    data: {
      status: 'finished',
      finishReason: 'access_changed',
      finishedAt: now,
    },
  });
};

export const finishFreeForSalonAccess_IO = (
  tx: SalonAccessTx,
  salonAccountId: string,
  userId?: string,
  now = new Date()
) =>
  finishFreeForMemberships_IO(
    tx,
    {
      stylist_account_id: salonAccountId,
      ...(userId ? { user_id: userId } : {}),
    },
    now
  );

export const finishFreeForSalonOwners_IO = (
  tx: SalonAccessTx,
  ownerUserIds: string[],
  now = new Date()
) =>
  finishFreeForMemberships_IO(
    tx,
    { stylist_account: { created_by_user_id: { in: ownerUserIds } } },
    now
  );
