import { DB_CLIENT } from '@app/db/db.client';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';

/**
 * A chat contact or pending request cannot reveal inspiration/CRM content.
 * ACTIVE retains normal access; REVOKED and absent historical pair rows retain
 * the pre-existing read-only shared-session archive grant.
 */
export const sessionStylistRelationshipWhere = (stylistAccountId: string) => ({
  client_account: {
    created_by_user: {
      client_pairings: {
        none: {
          stylist_account_id: stylistAccountId,
          status: {
            notIn: ['ACTIVE', 'REVOKED'] as Array<'ACTIVE' | 'REVOKED'>,
          },
        },
      },
    },
  },
});

export const canAcceptSession = async (
  session: SessionContainerDetailDTO,
  stylistAccountId: string | undefined,
  stylistViewer: boolean
): Promise<boolean> => {
  if (
    !stylistViewer ||
    !stylistAccountId ||
    !session.clientUserId ||
    session.accepted_at ||
    !session.sharedAt ||
    session.closedAt ||
    !['SHARED', 'ACTIVE'].includes(session.lifecycleState) ||
    !session.expiresAt ||
    new Date(session.expiresAt) <= new Date()
  ) {
    return false;
  }
  const pair = await DB_CLIENT.use.clientStylistPair.findFirst({
    where: {
      client_user_id: session.clientUserId,
      stylist_account_id: stylistAccountId,
      status: 'ACTIVE',
      client_user: { is_active: true },
      stylist_account: {
        account_status: 'ACTIVE',
        created_by_user: { is_active: true },
      },
    },
    select: { id: true, salon_origin_account_id: true },
  });
  if (!pair) {
    return false;
  }
  return (
    !pair.salon_origin_account_id ||
    Boolean(await resolveSalonAccess_IO(session.clientUserId, stylistAccountId))
  );
};
