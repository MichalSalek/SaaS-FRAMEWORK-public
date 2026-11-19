import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import { finishFreeForSalonAccess_IO } from '@domain/email/operations/free-email.salon-access';
import { salonDisplayName } from '@kernel/domain/salon-profile/salon-names';
import { lockStylistAccount } from '@app/db/lock-rows';
import { attachAcceptedSalonInvitations_IO } from '../salon-invitation-token.service';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { SalonStaffNotFoundError } from '@kernel/domain/salon-staff/salon-staff-errors.types';
import type { StaffInvitationResponse } from '@kernel/domain/user-and-account/staff_accounts.config';
import type {
  SALON_STAFF_DTO_API_V1,
  StaffInvitationDTO,
} from '@kernel/models/salon-staff/salon-staff.dto';
import type { Prisma } from '../../../prisma/js-client';
import { resolveInviterName } from '@domain/salon-staff/salon-staff.utils';

// `applied` = this request changed state (not a replay or a foreign no-op); the
// handler audits only then, so the trail records decisions, not clicks.
type RespondResult =
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE'] & {
    applied: boolean;
    /** Internal (stripped by the handler): the salon whose owner is told about an
     *  applied ACCEPT (notifications v2). Null when the row could not be read. */
    salon_account_id: string | null;
  };

// DECISION: an invitation is visible ONLY from a LIVE salon. Ban and self-deletion of the owner's account do NOT
// delete StaffMember rows (see liveStaffSeatWhere in salon-staff.utils.ts), so without this condition an invited
// stylist could see and accept an invitation from a salon that no longer exists. Both events freeze the owner's User
// (is_active=false; an admin ban also sets disabled_at), the same liveness signal as when inviting. The condition
// stands in both the list and the accept write: an invitation the list does not show cannot be accepted.
const LIVE_SALON_WHERE: Prisma.StaffMemberWhereInput = {
  stylist_account: {
    created_by_user: { is_active: true, disabled_at: null },
  },
};

/**
 * The caller's own pending salon-team invitations (accepted_at null, membership
 * active, inviting salon alive). Scoped by the session user only.
 */
export const getMyStaffInvitations_IO = async ({
  userId,
}: {
  userId: string;
}): Promise<
  OperationResult<{ invitations: StaffInvitationDTO[] }, DatabaseError>
> => {
  try {
    const rows = await DB_CLIENT.use.staffMember.findMany({
      where: {
        ...LIVE_SALON_WHERE,
        user_id: userId,
        is_active: true,
        accepted_at: null,
      },
      select: {
        id: true,
        stylist_account_id: true,
        role: true,
        invited_at: true,
        stylist_account: {
          select: {
            display_name: true,
            business_name: true,
            salon_profile_name: true,
            avatar_url: true,
            created_by_user: {
              select: { name: true, image: true, avatar_url: true },
            },
          },
        },
      },
      // Oldest first + id tie-break (repo pagination-tiebreaker convention). The
      // per-user list is tiny (one row per salon that invited her), the take is a
      // safety cap, not pagination.
      orderBy: [{ invited_at: 'asc' }, { id: 'asc' }],
      take: 50,
    });

    const user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const emailInvitations = user
      ? await DB_CLIENT.use.salonInvitation.findMany({
          where: {
            email: user.email.toLowerCase(),
            accepted_at: null,
            declined_at: null,
            expires_at: { gt: new Date() },
            salon: { created_by_user: { is_active: true, disabled_at: null } },
          },
          include: {
            salon: {
              select: {
                display_name: true,
                business_name: true,
                salon_profile_name: true,
                avatar_url: true,
                created_by_user: {
                  select: { name: true, image: true, avatar_url: true },
                },
              },
            },
          },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          take: 50,
        })
      : [];
    return success({
      invitations: [
        ...emailInvitations.map(row => ({
          staff_member_id: row.id,
          salon_account_id: row.salon_account_id,
          inviter_name: resolveInviterName(row.salon),
          salon_name: salonDisplayName(row.salon),
          owner_avatar_url: resolvePersonAvatarUrl(
            row.salon.created_by_user ?? {}
          ),
          role: row.role,
          invited_at: row.created_at.toISOString(),
        })),
        ...rows.map(row => ({
          staff_member_id: row.id,
          salon_account_id: row.stylist_account_id,
          inviter_name: resolveInviterName(row.stylist_account),
          salon_name:
            row.stylist_account.salon_profile_name?.trim() ||
            row.stylist_account.business_name?.trim() ||
            null,
          owner_avatar_url: resolvePersonAvatarUrl(
            row.stylist_account.created_by_user ?? {}
          ),
          role: row.role,
          invited_at: row.invited_at.toISOString(),
        })),
      ],
    });
  } catch (error) {
    return databaseFailure('getMyStaffInvitations', error);
  }
};

/**
 * The invited stylist answers her own invitation.
 *
 * ACCEPT writes accepted_at = now (her consent to be listed by name and photo in
 * that salon's team; the roster mask lifts on it). DECLINE removes the membership
 * with the same hard delete an owner removal uses (removeStaffMember_IO), so the
 * seat is freed and the owner may invite her again.
 */
export const respondToStaffInvitation_IO = async ({
  userId,
  staffMemberId,
  response,
}: {
  userId: string;
  staffMemberId: string;
  response: StaffInvitationResponse;
}): Promise<
  OperationResult<RespondResult, SalonStaffNotFoundError | DatabaseError>
> => {
  // DECISION: the response is RACE-SAFE and IDEMPOTENT. Both writes are ONE conditional SQL statement with the full
  // predicate (id + user_id from the session + accepted_at IS NULL), so ownership and state are checked by the write
  // itself, with no TOCTOU window between read and write. With two devices at once Postgres serializes them on the row
  // lock and the loser re-evaluates the WHERE after the winner's commit, so ACCEPT vs DECLINE ends in one consistent
  // state and the loser gets count 0. Only then one read decides what zero means:
  //  - ACCEPT, row already accepted -> the same success (double tap, HTTP retry);
  //  - ACCEPT, row missing or foreign -> SALON_STAFF_NOT_FOUND (404, no oracle: "foreign" and "missing" look alike);
  //  - DECLINE, row missing (already declined or foreign id) -> success, as with D1 when the owner removes: the target
  //    state is reached and a foreign row is untouched because user_id in the predicate comes from the session;
  //  - DECLINE, membership already accepted -> SALON_STAFF_NOT_FOUND: it is no longer an invitation, and leaving a
  //    team is a separate product decision (today the owner does it via "Usuń z zespołu").
  try {
    const sessionUser = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const emailInvitation = sessionUser
      ? await DB_CLIENT.use.salonInvitation.findFirst({
          where: {
            id: staffMemberId,
            email: sessionUser.email.toLowerCase(),
            declined_at: null,
            OR: [
              { accepted_at: { not: null } },
              { expires_at: { gt: new Date() } },
            ],
            salon: { created_by_user: { is_active: true, disabled_at: null } },
          },
        })
      : null;
    if (emailInvitation && sessionUser) {
      if (response === 'DECLINE') {
        return await DB_CLIENT.use.$transaction(async tx => {
          await lockStylistAccount(tx, emailInvitation.salon_account_id);
          const current = await tx.salonInvitation.findUnique({
            where: { id: emailInvitation.id },
          });
          if (current?.accepted_at) {
            return failure({
              type: 'SALON_STAFF_NOT_FOUND' as const,
              staffId: staffMemberId,
            });
          }
          const declined = await tx.salonInvitation.updateMany({
            where: {
              id: emailInvitation.id,
              accepted_at: null,
              declined_at: null,
            },
            data: { declined_at: new Date() },
          });
          return success({
            staff_member_id: staffMemberId,
            status: 'DECLINED' as const,
            accepted_at: null,
            applied: declined.count > 0,
            salon_account_id: emailInvitation.salon_account_id,
          });
        });
      }
      const now = new Date();
      const updated = await DB_CLIENT.use.salonInvitation.updateMany({
        where: {
          id: emailInvitation.id,
          email: sessionUser.email.toLowerCase(),
          accepted_at: null,
          declined_at: null,
          expires_at: { gt: now },
          salon: { created_by_user: { is_active: true, disabled_at: null } },
        },
        data: { accepted_at: now },
      });
      const accepted = await DB_CLIENT.use.salonInvitation.findFirst({
        where: {
          id: emailInvitation.id,
          email: sessionUser.email.toLowerCase(),
          declined_at: null,
          salon: { created_by_user: { is_active: true, disabled_at: null } },
        },
        select: { accepted_at: true },
      });
      if (!accepted?.accepted_at) {
        return failure({
          type: 'SALON_STAFF_NOT_FOUND',
          staffId: staffMemberId,
        });
      }
      await attachAcceptedSalonInvitations_IO(userId, {
        required: emailInvitation.id,
      });
      return success({
        staff_member_id: staffMemberId,
        status: 'ACCEPTED',
        accepted_at: accepted.accepted_at.toISOString(),
        applied: updated.count > 0,
        salon_account_id: emailInvitation.salon_account_id,
      });
    }
    if (response === 'ACCEPT') {
      return await DB_CLIENT.use.$transaction(async tx => {
        const acceptedAt = new Date();
        const updated = await tx.staffMember.updateMany({
          where: {
            ...LIVE_SALON_WHERE,
            id: staffMemberId,
            user_id: userId,
            is_active: true,
            accepted_at: null,
          },
          data: { accepted_at: acceptedAt },
        });
        if (updated.count > 0) {
          const member = await tx.staffMember.findFirst({
            where: { id: staffMemberId, user_id: userId },
            select: { stylist_account_id: true },
          });
          if (member) {
            await finishFreeForSalonAccess_IO(
              tx,
              member.stylist_account_id,
              userId
            );
          }
          return success({
            staff_member_id: staffMemberId,
            status: 'ACCEPTED',
            accepted_at: acceptedAt.toISOString(),
            applied: true,
            salon_account_id: member?.stylist_account_id ?? null,
          });
        }
        const existing = await tx.staffMember.findFirst({
          where: { id: staffMemberId, user_id: userId, is_active: true },
          select: { accepted_at: true, stylist_account_id: true },
        });
        if (existing?.accepted_at) {
          await finishFreeForSalonAccess_IO(
            tx,
            existing.stylist_account_id,
            userId
          );
          return success({
            staff_member_id: staffMemberId,
            status: 'ACCEPTED',
            accepted_at: existing.accepted_at.toISOString(),
            applied: false,
            salon_account_id: existing.stylist_account_id,
          });
        }
        return failure({
          type: 'SALON_STAFF_NOT_FOUND',
          staffId: staffMemberId,
        });
      });
    }

    const removed = await DB_CLIENT.use.staffMember.deleteMany({
      where: { id: staffMemberId, user_id: userId, accepted_at: null },
    });
    if (removed.count === 0) {
      const stillMember = await DB_CLIENT.use.staffMember.findFirst({
        where: { id: staffMemberId, user_id: userId },
        select: { id: true },
      });
      if (stillMember) {
        return failure({
          type: 'SALON_STAFF_NOT_FOUND',
          staffId: staffMemberId,
        });
      }
    }
    return success({
      staff_member_id: staffMemberId,
      status: 'DECLINED',
      accepted_at: null,
      applied: removed.count > 0,
      salon_account_id: null,
    });
  } catch (error) {
    return databaseFailure('respondToStaffInvitation', error);
  }
};
