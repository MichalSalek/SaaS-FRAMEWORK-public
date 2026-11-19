import type { Prisma } from '../../../prisma/js-client';

export const recordTermsAcceptance = async (
  tx: Prisma.TransactionClient,
  userId: string,
  termsAccepted: boolean
): Promise<void> => {
  if (!termsAccepted) {
    return;
  }
  await tx.user.updateMany({
    where: { id: userId, terms_accepted_at: null },
    data: { terms_accepted_at: new Date() },
  });
};
