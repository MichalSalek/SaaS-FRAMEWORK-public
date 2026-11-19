import { DB_CLIENT } from '@app/db/db.client';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { Prisma } from '../../../prisma/js-client';

/** EventLog keeps a soft user id, so the exclusion must precede LIMIT in SQL. */
export const noPriorEmailAudit = (
  userId: Prisma.Sql,
  event: string,
  since?: Date
): Prisma.Sql => Prisma.sql`
  NOT EXISTS (
    SELECT 1 FROM "EventLog" e
     WHERE e."created_by_user_id" = ${userId}
       AND e."event" = ${event}
       AND e."event_type"::text = ${EventLogTypeValue.EMAIL}
       ${since ? Prisma.sql`AND e."created_at" >= ${since}` : Prisma.empty}
  )
`;

/** Group before LIMIT so duplicate audit rows cannot hide another user. */
export const usersWithEmailAudit = async (
  userIds: readonly string[],
  event: string,
  since?: Date
): Promise<Set<string>> => {
  if (!userIds.length) {
    return new Set();
  }
  const rows = await DB_CLIENT.use.eventLog.groupBy({
    by: ['created_by_user_id'],
    where: {
      event,
      event_type: EventLogTypeValue.EMAIL,
      created_by_user_id: { in: [...userIds] },
      ...(since ? { created_at: { gte: since } } : {}),
    },
    orderBy: { created_by_user_id: 'asc' },
    take: userIds.length,
  });
  return new Set(rows.map(row => row.created_by_user_id));
};
