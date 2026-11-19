import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import { salonDisplayName } from '@kernel/domain/salon-profile/salon-names';
import { reconcileSalonDerivedPairingsAfterCommit_IO } from '@domain/pairing/salon-derived-cleanup.operations';
import { lockStylistAccount } from '@app/db/lock-rows';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { success } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { SalonTeamDTO } from '@kernel/models/salon-staff/salon-staff.dto';
import { finishAcceptedSalonInvitations } from '../salon-invitation-token.service';
import { resolveStaffPersonName } from '../salon-staff.utils';
import { canManageSalonProfile } from '@domain/salon-profile/salon-profile.policy';

export const getMySalonTeams_IO = async (
  userId: string
): Promise<
  OperationResult<
    SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_TEAM']['RESPONSE'],
    DatabaseError
  >
> => {
  try {
    await finishAcceptedSalonInvitations(userId, 'team screen');
    const memberships = await DB_CLIENT.use.staffMember.findMany({
      where: {
        user_id: userId,
        accepted_at: { not: null },
        is_active: true,
        stylist_account: {
          created_by_user: { is_active: true, disabled_at: null },
        },
      },
      select: {
        stylist_account: {
          select: {
            account_id: true,
            account_status: true,
            pricing_plan: true,
            subscription_status: true,
            payment_status: true,
            account_expiration_date: true,
            avatar_url: true,
            business_name: true,
            salon_profile_name: true,
            display_name: true,
            created_by_user: {
              select: { id: true, name: true, image: true, avatar_url: true },
            },
            staff_members: {
              where: {
                is_active: true,
                accepted_at: { not: null },
                user: { is_active: true, disabled_at: null },
              },
              select: {
                id: true,
                role: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    image: true,
                    avatar_url: true,
                    stylist_account: {
                      select: {
                        account_id: true,
                        account_status: true,
                        display_name: true,
                        business_name: true,
                        avatar_url: true,
                      },
                    },
                  },
                },
              },
              orderBy: [{ invited_at: 'asc' }, { id: 'asc' }],
              take: 200,
            },
          },
        },
      },
      orderBy: [{ invited_at: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    const teams: SalonTeamDTO[] = memberships.map(
      ({ stylist_account: salon }) => ({
        salon_account_id: salon.account_id,
        salon_name: salonDisplayName(salon),
        gallery_available: canManageSalonProfile(salon),
        owner: {
          user_id: salon.created_by_user.id,
          name: resolveStaffPersonName(salon, salon.created_by_user.name),
          image: resolvePersonAvatarUrl(salon.created_by_user),
          public_profile_id:
            salon.account_status === 'ACTIVE' ? salon.account_id : null,
        },
        members: salon.staff_members.map(member => ({
          staff_member_id: member.id,
          role: member.role,
          user_id: member.user.id,
          name: resolveStaffPersonName(
            member.user.stylist_account,
            member.user.name
          ),
          image: resolvePersonAvatarUrl(member.user),
          public_profile_id:
            member.user.stylist_account?.account_status === 'ACTIVE'
              ? member.user.stylist_account.account_id
              : null,
        })),
      })
    );
    const currentUser = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        stylist_account: { select: { account_id: true } },
      },
    });
    if (currentUser && !currentUser.stylist_account) {
      const waiting = await DB_CLIENT.use.salonInvitation.findMany({
        where: {
          email: currentUser.email.toLowerCase(),
          accepted_at: { not: null },
          declined_at: null,
          attached_user_id: null,
          salon: { created_by_user: { is_active: true, disabled_at: null } },
        },
        select: {
          salon: {
            select: {
              salon_profile_name: true,
              business_name: true,
              display_name: true,
            },
          },
        },
        take: 50,
      });
      return success({
        teams,
        awaiting_stylist_salon_names: waiting.map(({ salon }) =>
          salonDisplayName(salon)
        ),
      });
    }
    return success({ teams });
  } catch (error) {
    return databaseFailure('getMySalonTeams', error);
  }
};
export const leaveSalonTeam_IO = async (
  userId: string,
  salonAccountId: string
) => {
  try {
    await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, salonAccountId);
      await tx.staffMember.deleteMany({
        where: {
          user_id: userId,
          stylist_account_id: salonAccountId,
          accepted_at: { not: null },
        },
      });
      await tx.salonInvitation.updateMany({
        where: { attached_user_id: userId, salon_account_id: salonAccountId },
        data: { declined_at: new Date() },
      });
    });
    await reconcileSalonDerivedPairingsAfterCommit_IO(
      { salonAccountId },
      'leaveSalonTeam'
    );
    return success({ success: true });
  } catch (error) {
    return databaseFailure('leaveSalonTeam', error);
  }
};
