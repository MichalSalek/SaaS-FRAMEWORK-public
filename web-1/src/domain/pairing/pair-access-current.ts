import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';
import type { Prisma } from '../../prisma/js-client';

/** A derived pair can remain ACTIVE while best-effort salon cleanup is pending. */
export const clientPairAccessIsCurrent = async (
  pair: { salon_origin_account_id: string | null },
  clientUserId: string,
  stylistAccountId: string,
  tx?: Prisma.TransactionClient
): Promise<boolean> =>
  !pair.salon_origin_account_id ||
  Boolean(await resolveSalonAccess_IO(clientUserId, stylistAccountId, tx));
