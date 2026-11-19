import { DB_CLIENT } from '@app/db/db.client';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';
import { lifecycleActionsSql } from './lifecycle-actions.sql';

type ActionRow = { id: string; accountId: string; occurredAt: Date } & (
  | { entryId: null }
  | {
      entryId: string;
      messageId: string;
      ctaId: string;
      enteredAt: Date;
      family: string;
      ruleId: string;
      templateId: string;
      locale: string;
      cohort: string;
      provider: string | null;
    }
);

/** Reads the confirmed stylist's receipts, regardless of the active UI role or who performed the action. */
export async function getLifecycleActions(
  userId: string,
  cursor?: string,
  now = new Date()
): Promise<EMAIL_DTO_API_V1['EMAIL_LIFECYCLE_ACTIONS']['RESPONSE']> {
  const rows = await DB_CLIENT.use.$queryRaw<ActionRow[]>(
    lifecycleActionsSql(userId, cursor, now)
  );
  const actions = rows.map(row => ({
    id: row.id,
    accountId: row.accountId,
    occurredAt: row.occurredAt.toISOString(),
    attribution:
      row.entryId !== null
        ? {
            accountId: row.accountId,
            messageId: row.messageId,
            entryId: row.entryId,
            ctaId: row.ctaId,
            enteredAt: row.enteredAt.toISOString(),
            family: row.family,
            ruleId: row.ruleId,
            templateId: row.templateId,
            locale: row.locale,
            cohort: row.cohort,
            provider: row.provider,
          }
        : null,
  }));
  return {
    actions,
    nextCursor: rows.length === 50 ? (rows.at(-1)?.id ?? null) : null,
  };
}
