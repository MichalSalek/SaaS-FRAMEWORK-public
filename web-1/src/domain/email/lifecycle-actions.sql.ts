import { Prisma } from '../../prisma/js-client';

/** One round trip, owner-scoped cursor, and a deterministic last preceding entry for each bounded action. */
export function lifecycleActionsSql(
  userId: string,
  cursor: string | undefined,
  now: Date
) {
  return Prisma.sql`
    WITH eligible AS (
      SELECT a."id", a."accountId", a."occurredAt"
      FROM "EmailLifecycleAction" a
      WHERE a."userId" = ${userId} AND a."kind" = 'connection_accepted'
        AND a."occurredAt" >= ${new Date(now.getTime() - 90 * 86400000)}
        AND a."occurredAt" <= ${now}
        AND (${cursor ?? null}::text IS NULL OR (a."occurredAt", a."id") < (
          SELECT c."occurredAt", c."id" FROM "EmailLifecycleAction" c
          WHERE c."id" = ${cursor ?? null} AND c."userId" = ${userId}
            AND c."kind" = 'connection_accepted'
        ))
      ORDER BY a."occurredAt" DESC, a."id" DESC LIMIT 50
    )
    SELECT a."id", a."accountId", a."occurredAt", attribution.*
    FROM eligible a
    LEFT JOIN LATERAL (
      SELECT e."id" AS "entryId", e."messageId", e."ctaId", e."createdAt" AS "enteredAt",
        m."family", m."ruleId", m."templateId", m."locale", m."cohort", m."provider"
      FROM "EmailLifecycleEntry" e
      JOIN "EmailLifecycleMessage" m ON m."id" = e."messageId"
      WHERE e."userId" = ${userId} AND m."userId" = ${userId}
        AND m."accountId" = a."accountId" AND m."acceptedAt" IS NOT NULL
        AND e."createdAt" >= a."occurredAt" - INTERVAL '7 days'
        AND e."createdAt" <= a."occurredAt"
      ORDER BY e."createdAt" DESC, e."id" DESC LIMIT 1
    ) attribution ON TRUE
    ORDER BY a."occurredAt" DESC, a."id" DESC
  `;
}
