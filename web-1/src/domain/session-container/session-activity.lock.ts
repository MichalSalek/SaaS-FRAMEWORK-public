import type { Prisma } from '../../prisma/js-client';
import {
  lockSessionContainer,
  lockStylistAccount,
  lockUserRow,
} from '@app/db/lock-rows';
import {
  ensureSalonPairing_IO,
  resolveSalonAccess_IO,
} from '@domain/pairing/salon-access.resolver';
import { nextConversationActivity } from './session-activity.clock';

/** Notifications and the mail ledger reference the recipient User as well. */
export const lockSessionActivityUsers = async (
  tx: Prisma.TransactionClient,
  clientUserId: string,
  stylistId?: string
) => {
  const stylist = stylistId
    ? await tx.stylistAccount.findUnique({
        where: { account_id: stylistId },
        select: { created_by_user_id: true },
      })
    : null;
  const ids = [
    ...new Set(
      [clientUserId, stylist?.created_by_user_id].filter(
        (id): id is string => typeof id === 'string'
      )
    ),
  ].sort();
  for (const id of ids) {
    await lockUserRow(tx, id);
  }
};

/** Resolve the pair before locking the session. No lower-rank lookup after the session lock. */
export const lockSessionActivityContext = async (
  tx: Prisma.TransactionClient,
  sessionId: string,
  options: { fallbackStylistId?: string; ensureSalonPair?: boolean } = {}
) => {
  const initial = await tx.sessionContainer.findUnique({
    where: { id: sessionId },
    include: { client_account: { select: { created_by_user_id: true } } },
  });
  if (!initial) {
    return null;
  }
  const userId = initial.client_account.created_by_user_id;
  const stylistId = initial.stylist_account_id ?? options.fallbackStylistId;
  await lockSessionActivityUsers(tx, userId, stylistId);
  if (stylistId) {
    await lockStylistAccount(tx, stylistId);
  }
  if (stylistId && options.ensureSalonPair) {
    await ensureSalonPairing_IO(userId, stylistId, tx);
  }
  const pair = stylistId
    ? await tx.clientStylistPair.findUnique({
        where: {
          client_user_id_stylist_account_id: {
            client_user_id: userId,
            stylist_account_id: stylistId,
          },
        },
      })
    : null;
  const activityAt = pair
    ? await nextConversationActivity(tx, pair.id)
    : new Date();
  if (!(await lockSessionContainer(tx, sessionId))) {
    return null;
  }
  const session = await tx.sessionContainer.findUniqueOrThrow({
    where: { id: sessionId },
  });
  const activePair = pair
    ? await tx.clientStylistPair.findFirst({
        where: {
          id: pair.id,
          status: 'ACTIVE',
          client_user: { is_active: true },
          stylist_account: {
            account_status: 'ACTIVE',
            created_by_user: { is_active: true },
          },
        },
        select: { id: true, salon_origin_account_id: true },
      })
    : null;
  const salonAccess =
    activePair?.salon_origin_account_id && stylistId
      ? await resolveSalonAccess_IO(userId, stylistId, tx)
      : null;
  return {
    session,
    pairId: pair?.id ?? null,
    activePairId:
      activePair && (!activePair.salon_origin_account_id || salonAccess)
        ? activePair.id
        : null,
    activityAt,
    userId,
  };
};
