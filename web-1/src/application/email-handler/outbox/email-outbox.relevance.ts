import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { PaymentStatusValue } from '@kernel/models/db_models.generated.dto';
import { activityEmailsAllowed_IO } from '@app/email-handler/activity-email-consent';
import { DB_CLIENT } from '@app/db/db.client';
import { parseOutboxPayload, type OutboxRow } from './email-outbox.policy';
import { clientPairAccessIsCurrent } from '@app/interceptors/salon-pair-access.gateway';

type AccountState = { payment_status: string; pricing_plan: string };

/**
 * Is an outbox message still true for the account right now? Checked before every claim, so a
 * mail delayed by a crash or a retry never contradicts the account: a payment-failed or dunning
 * mail after the card went through, an upgrade confirmation after the plan dropped to Free, a
 * downgrade notice after the stylist paid again. A kind without a rule stays relevant.
 */
export const isOutboxMessageRelevant = (
  row: Pick<OutboxRow, 'ruleId' | 'templateId'>,
  account: AccountState | null
): boolean => {
  if (!account) {
    return false;
  }
  if (
    row.ruleId === 'payment-failed' ||
    row.templateId.startsWith('dunning-')
  ) {
    return account.payment_status !== PaymentStatusValue.PAID;
  }
  if (row.templateId === 'upgrade-confirmation') {
    return account.pricing_plan !== PricingPlanValue.FREE;
  }
  if (row.templateId === 'downgrade-notification') {
    return account.pricing_plan === PricingPlanValue.FREE;
  }
  return true;
};

export const loadOutboxRelevance = async (row: OutboxRow): Promise<boolean> => {
  if (row.ruleId === 'session-shared') {
    if (!(await activityEmailsAllowed_IO(row.userId))) {
      return false;
    }
    const session = await DB_CLIENT.use.sessionContainer.findFirst({
      where: {
        id: parseOutboxPayload(row.outboxPayload)?.vars.sessionId ?? '',
        stylist_account_id: row.accountId,
        shared_at: { not: null },
      },
      select: { client_account: { select: { created_by_user_id: true } } },
    });
    if (!session) {
      return false;
    }
    const clientUserId = session.client_account.created_by_user_id;
    const pair = await DB_CLIENT.use.clientStylistPair.findFirst({
      where: {
        client_user_id: clientUserId,
        stylist_account_id: row.accountId,
        status: 'ACTIVE',
        stylist_hidden_at: null,
        client_user: { is_active: true },
        stylist_account: {
          account_status: 'ACTIVE',
          created_by_user: { is_active: true },
        },
      },
      select: { id: true, salon_origin_account_id: true },
    });
    return Boolean(
      pair &&
      (await clientPairAccessIsCurrent(pair, clientUserId, row.accountId))
    );
  }
  return isOutboxMessageRelevant(
    row,
    await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: row.accountId },
      select: { payment_status: true, pricing_plan: true },
    })
  );
};
