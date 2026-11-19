import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';
// The salon's first-message transaction owns contact creation and the message;
// ordinary messages keep their existing independent serializable transaction.
export async function runMessagingTransaction_IO<T>(
  tx: Prisma.TransactionClient | undefined,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel: 'Serializable' }
): Promise<T> {
  return tx ? action(tx) : DB_CLIENT.use.$transaction(action, options);
}
