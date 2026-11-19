import { finishFreeForSalonAccess_IO } from '@domain/email/operations/free-email.salon-access';
import { salonDisplayName } from '@kernel/domain/salon-profile/salon-names';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { createHash, randomBytes } from 'node:crypto';
import { DB_CLIENT } from '@app/db/db.client';
import { DEFAULT_PERMISSIONS_BY_ROLE } from '@kernel/domain/user-and-account/staff_accounts.config';
import { lockInOrder, lockStylistAccount } from '@app/db/lock-rows';
import { salonInvitationAttachLockPlan } from '@app/db/lock-plans';
import { reportIssueBackend } from '@app/debugger/error-handler';

export const createInvitationToken = () =>
  randomBytes(32).toString('base64url');
export const hashInvitationToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// DECISION: an accepted invitation becomes a membership on the EVENTS that can complete it, never on
// every authenticated request (owner): the acceptance itself (token
// link, in-app answer), a stylist account appearing (onboarding, role switch, archive restore), the
// account or its salon owner becoming active again (reactivation, admin enable), every Better Auth
// sign-in and the team screen. The pending state lives only in the database (accepted_at set,
// attached_user_id null), so a failed attempt or a restart loses nothing: the next of those events
// finishes it. Each invitation attaches in its own transaction under the salon row lock and re-checks
// attached_user_id, and StaffMember is unique per (salon, user), so concurrent triggers never produce
// a second membership. Only the invitation being accepted right now may fail its request
// (`required`); every other one is reported and stays pending.
/**
 * Attaches every accepted, not yet attached invitation of this stylist. With `required`, only that
 * invitation's failure is thrown and the others are reported; without it the first failure is
 * thrown after all were tried.
 */
export const attachAcceptedSalonInvitations_IO = async (
  userId: string,
  options: { required?: string } = {}
) => {
  const user = await DB_CLIENT.use.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      is_active: true,
      disabled_at: true,
      stylist_account: { select: { account_id: true } },
    },
  });
  if (!user?.stylist_account || !user.is_active || user.disabled_at) {
    return;
  }
  const invitations = await DB_CLIENT.use.salonInvitation.findMany({
    where: {
      email: user.email.toLowerCase(),
      accepted_at: { not: null },
      declined_at: null,
      attached_user_id: null,
    },
    select: { id: true, salon_account_id: true },
    take: 50,
  });
  const failures: { id: string; error: unknown }[] = [];
  for (const invitation of invitations) {
    try {
      await attachOneInvitation(userId, invitation);
    } catch (error) {
      failures.push({ id: invitation.id, error });
    }
  }
  if (options.required === undefined) {
    if (failures[0] !== undefined) {
      throw failures[0].error;
    }
    return;
  }
  const own = failures.find(failure => failure.id === options.required);
  const others = failures.filter(failure => failure !== own);
  if (others.length > 0) {
    reportIssueBackend({
      namespace: 'SALON_INVITATION_ATTACH_OTHERS',
      message: `${others.length} other accepted salon invitation(s) stay pending`,
      payload: others.map(failure => failure.error),
      mode: 'error',
    });
  }
  if (own !== undefined) {
    throw own.error;
  }
};

const attachOneInvitation = (
  userId: string,
  invitation: { id: string; salon_account_id: string }
) =>
  DB_CLIENT.use.$transaction(async tx => {
    await lockInOrder(
      tx,
      salonInvitationAttachLockPlan(userId, invitation.salon_account_id)
    );
    const current = await tx.salonInvitation.findUnique({
      where: { id: invitation.id },
    });
    if (
      !current?.accepted_at ||
      current.declined_at ||
      current.attached_user_id
    ) {
      return;
    }
    const owner = await tx.stylistAccount.findFirst({
      where: {
        account_id: current.salon_account_id,
        created_by_user: { is_active: true, disabled_at: null },
      },
      select: { created_by_user_id: true },
    });
    if (!owner || owner.created_by_user_id === userId) {
      return;
    }
    const membership = await tx.staffMember.findUnique({
      where: {
        stylist_account_id_user_id: {
          stylist_account_id: current.salon_account_id,
          user_id: userId,
        },
      },
    });
    if (!membership) {
      await tx.staffMember.create({
        data: {
          stylist_account_id: current.salon_account_id,
          user_id: userId,
          role: current.role,
          permissions: [...DEFAULT_PERMISSIONS_BY_ROLE[current.role]],
          accepted_at: current.accepted_at,
        },
      });
    } else if (membership.accepted_at === null) {
      await tx.staffMember.update({
        where: { id: membership.id },
        data: { accepted_at: current.accepted_at },
      });
    }
    await finishFreeForSalonAccess_IO(tx, current.salon_account_id, userId);
    await tx.salonInvitation.update({
      where: { id: current.id },
      data: { attached_user_id: userId },
    });
  });

/**
 * The non-throwing trigger every event uses (sign-in, account restore, team screen): a failure is
 * reported under `trigger` and the invitations stay pending for the next event.
 */
export const finishAcceptedSalonInvitations = (
  userId: string,
  trigger: string
): Promise<void> =>
  attachAcceptedSalonInvitations_IO(userId).catch((error: unknown) => {
    reportIssueBackend({
      namespace: 'SALON_INVITATION_ATTACH',
      message: `Accepted salon invitations stay pending after ${trigger}`,
      payload: error,
      mode: 'error',
    });
  });

/**
 * The account became active again (reactivation, admin enable). Attachment skips an inactive
 * invitee AND an inactive salon owner, so both sides are finished: her own invitations, and those
 * accepted by stylists invited to her salon. Never throws.
 */
export const finishSalonInvitationsAfterReactivation = async (
  userId: string,
  trigger: string
): Promise<void> => {
  await finishAcceptedSalonInvitations(userId, trigger);
  try {
    const salon = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { created_by_user_id: userId },
      select: { account_id: true },
    });
    if (!salon) {
      return;
    }
    const pending = await DB_CLIENT.use.salonInvitation.findMany({
      where: {
        salon_account_id: salon.account_id,
        accepted_at: { not: null },
        declined_at: null,
        attached_user_id: null,
      },
      select: { email: true },
      take: 100,
    });
    if (pending.length === 0) {
      return;
    }
    const invitees = await DB_CLIENT.use.user.findMany({
      where: {
        email: { in: pending.map(row => row.email), mode: 'insensitive' },
        stylist_account: { isNot: null },
      },
      select: { id: true },
      take: 100,
    });
    for (const invitee of invitees) {
      await finishAcceptedSalonInvitations(invitee.id, trigger);
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'SALON_INVITATION_ATTACH',
      message: `Invitees of a reactivated salon owner stay pending after ${trigger}`,
      payload: error,
      mode: 'error',
    });
  }
};

/** This token conveys invitation consent only. It never creates an auth session. */
const acceptSalonInvitationToken = async ({
  token,
  currentEmail,
  response = 'ACCEPT',
}: {
  token: string;
  currentEmail?: string;
  response?: 'ACCEPT' | 'DECLINE';
}) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { status: 'INVALID' as const };
  }
  const hash = hashInvitationToken(token);
  const invitation = await DB_CLIENT.use.salonInvitation.findUnique({
    where: { token_hash: hash },
    include: {
      salon: {
        select: {
          business_name: true,
          salon_profile_name: true,
          display_name: true,
          created_by_user: { select: { is_active: true, disabled_at: true } },
        },
      },
    },
  });
  if (
    !invitation ||
    !invitation.salon.created_by_user?.is_active ||
    invitation.salon.created_by_user.disabled_at
  ) {
    return { status: 'INVALID' as const };
  }
  if (currentEmail && currentEmail.trim().toLowerCase() !== invitation.email) {
    return { status: 'WRONG_EMAIL' as const };
  }
  if (
    invitation.declined_at ||
    (!invitation.accepted_at && invitation.expires_at <= new Date())
  ) {
    return { status: 'INVALID' as const };
  }
  const now = new Date();
  if (response === 'DECLINE') {
    await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, invitation.salon_account_id);
      const current = await tx.salonInvitation.findUnique({
        where: { id: invitation.id },
      });
      if (!current || current.declined_at) {
        return;
      }
      await tx.salonInvitation.updateMany({
        where: { id: current.id, declined_at: null },
        data: { declined_at: now },
      });
      if (current.attached_user_id) {
        await tx.staffMember.deleteMany({
          where: {
            stylist_account_id: current.salon_account_id,
            user_id: current.attached_user_id,
          },
        });
      }
    });
    return {
      status: 'DECLINED' as const,
      email: invitation.email,
      salon_name: salonDisplayName(invitation.salon),
    };
  }
  await DB_CLIENT.use.salonInvitation.updateMany({
    where: {
      id: invitation.id,
      accepted_at: null,
      declined_at: null,
      expires_at: { gt: now },
    },
    data: { accepted_at: now },
  });
  const accepted = await DB_CLIENT.use.salonInvitation.findUnique({
    where: { id: invitation.id },
    select: { accepted_at: true, declined_at: true },
  });
  if (!accepted?.accepted_at || accepted.declined_at) {
    return { status: 'INVALID' as const };
  }
  const user = await DB_CLIENT.use.user.findFirst({
    where: { email: invitation.email },
    select: { id: true, stylist_account: { select: { account_id: true } } },
  });
  if (user?.stylist_account) {
    await attachAcceptedSalonInvitations_IO(user.id, {
      required: invitation.id,
    });
  }
  return {
    status: 'ACCEPTED' as const,
    email: invitation.email,
    salon_name: salonDisplayName(invitation.salon),
    requires_stylist_account: !user?.stylist_account,
    // Internal (stripped by the handler): who to tell about the acceptance
    // (notifications v2). Null when the invitee has no account yet.
    salon_account_id: invitation.salon_account_id,
    accepted_user_id: user?.id ?? null,
  };
};

export const acceptSalonInvitationToken_IO = async (
  params: Parameters<typeof acceptSalonInvitationToken>[0]
) => {
  try {
    const result = await acceptSalonInvitationToken(params);
    if (result.status === 'INVALID' || result.status === 'WRONG_EMAIL') {
      return failure({
        type: 'VALIDATION_ERROR' as const,
        field: 'token',
        message: result.status,
      });
    }
    return success(result);
  } catch (error) {
    return databaseFailure('acceptSalonInvitationToken', error);
  }
};
