import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { randomUUID } from 'node:crypto';
import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';
import { FREE_EMAIL_CONFIG } from '@kernel/domain/email/email-free.config';
import { lifecycleAddressHash } from '@app/email-handler/lifecycle/ledger';
import { TIME } from '@kernel/application/constants.config';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';

/** Called only by the explicit stylist onboarding transaction, never role switching. */
export const enrollFreeOnboarding_IO = async (
  tx: Prisma.TransactionClient,
  userId: string,
  accountId: string,
  now = new Date()
): Promise<void> => {
  const campaign = await tx.emailLifecycleCampaign.findUnique({
    where: { id: FREE_EMAIL_CONFIG.CAMPAIGN_ID },
  });
  if (!campaign?.startedAt || now < campaign.startedAt) {
    return;
  }
  // Account creation can come from role switching. Only this explicit operation starts Free tips,
  // and a previous successful explicit onboarding must never become a new sequence on resubmit.
  const previous = await tx.eventLog.findFirst({
    where: {
      created_by_user_id: userId,
      event: APP_EVENTS.INFO.USER.STYLIST_ACCOUNT_CREATED,
      event_type: EventLogTypeValue.ACCOUNT,
      created_at: { lte: now },
    },
    select: { event_log_id: true },
  });
  if (previous) {
    return;
  }
  const account = await tx.stylistAccount.findUnique({
    where: { account_id: accountId },
    select: {
      email_trial_sequence: true,
      trial_started_at: true,
      subscription_id: true,
      pricing_plan: true,
    },
  });
  if (!account) {
    return;
  }
  const finishReason = !account.email_trial_sequence
    ? 'unsubscribed'
    : account.trial_started_at ||
        account.subscription_id ||
        account.pricing_plan !== 'FREE'
      ? 'access_changed'
      : null;
  await tx.freeEmailEnrollment.createMany({
    data: [
      {
        accountId,
        userId,
        cohort: 'new',
        version: FREE_EMAIL_CONFIG.VERSION,
        startedAt: now,
        ...(finishReason
          ? { status: 'finished', finishReason, finishedAt: now }
          : {}),
      },
    ],
    skipDuplicates: true,
  });
};

/** One immutable existing cohort, captured atomically before any Free delivery. */
export const initializeFreeEmailCampaign_IO = async (now = new Date()) =>
  DB_CLIENT.use.$transaction(
    async tx => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('free-email-campaign-v1', 0))`
      );
      let campaign = await tx.emailLifecycleCampaign.findUnique({
        where: { id: FREE_EMAIL_CONFIG.CAMPAIGN_ID },
      });
      const runtime = await tx.runtimeConfig.findUnique({
        where: { key: 'FREE_EMAIL_MODE' },
        select: { value: true },
      });
      const mode =
        runtime && ['OFF', 'PREVIEW', 'ON'].includes(runtime.value)
          ? runtime.value
          : (campaign?.mode ?? 'OFF');
      if (!campaign) {
        campaign = await tx.emailLifecycleCampaign.create({
          data: {
            id: FREE_EMAIL_CONFIG.CAMPAIGN_ID,
            mode,
            startedAt: now,
          },
        });
      }
      if (campaign.mode !== mode) {
        campaign = await tx.emailLifecycleCampaign.update({
          where: { id: campaign.id },
          data: { mode },
        });
      }
      if (
        campaign.mode === 'OFF' ||
        campaign.initializedAt ||
        !campaign.startedAt
      ) {
        return campaign;
      }
      const excluded = Object.values(TEST_USERS_CONFIG).map(user => user.email);
      // The SELECT fixes membership and progress in the same database snapshot as campaign closure.
      const rows = await tx.$queryRaw<
        Array<{ accountId: string; userId: string; email: string }>
      >(Prisma.sql`
      SELECT a.account_id AS "accountId", a.created_by_user_id AS "userId", u.email AS email
      FROM "StylistAccount" a
      JOIN "users" u ON u.id = a.created_by_user_id
      JOIN "Role" r ON r.id = u.role_id
      WHERE EXISTS (SELECT 1 FROM "EventLog" onboarding
        WHERE onboarding.created_by_user_id = u.id
          AND onboarding.event = ${APP_EVENTS.INFO.USER.STYLIST_ACCOUNT_CREATED}
          AND onboarding.event_type::text = 'ACCOUNT'
          AND onboarding.created_at < ${campaign.startedAt})
        AND a.pricing_plan::text = 'FREE' AND a.trial_started_at IS NULL
        AND a.subscription_id IS NULL AND a.payment_status::text NOT IN ('PAID', 'IN_PROGRESS')
        AND (a.subscription_status IS NULL OR a.subscription_status::text <> 'INCOMPLETE')
        AND a.account_status::text = 'ACTIVE' AND a.email_trial_sequence = true
        AND u.is_active = true AND u.disabled_at IS NULL AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM "EventLog" checkout WHERE checkout.created_by_user_id = u.id AND checkout.event = 'CHECKOUT_SESSION_CREATED' AND checkout.created_at > ${new Date(now.getTime() - TIME.MS_PER_DAY)})
        AND r.name <> 'MASTER_ADMIN' AND NOT (u.email = ANY(${excluded}))
        AND NOT EXISTS (SELECT 1 FROM "ClientStylistPair" p WHERE p.stylist_account_id = a.account_id AND p.status::text = 'ACTIVE')
        AND NOT EXISTS (
          SELECT 1 FROM "StaffMember" s JOIN "StylistAccount" owner ON owner.account_id = s.stylist_account_id
          JOIN "users" owner_user ON owner_user.id = owner.created_by_user_id
          WHERE s.user_id = u.id AND s.is_active = true AND s.accepted_at IS NOT NULL
            AND owner.pricing_plan::text IN ('STUDIO', 'SCALE') AND owner.subscription_status::text = 'ACTIVE'
            AND owner.account_status::text = 'ACTIVE' AND owner_user.is_active = true AND owner_user.disabled_at IS NULL
            AND (owner.account_expiration_date IS NULL OR owner.account_expiration_date > ${now})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "EventLog" e WHERE e.created_by_user_id = u.id AND e.event = 'ADMIN_PRICING_PLAN_CHANGED'
            AND e.event_payload->>'oldPricingPlan' IN ('PRO', 'PRO_PLUS', 'STUDIO', 'SCALE')
        )
      ORDER BY a.account_id LIMIT 10001
    `);
      if (rows.length > 10000) {
        throw new Error(
          'Free email cohort exceeds the reviewed snapshot bound'
        );
      }
      const suppressions = await tx.emailDeliverySuppression.findMany({
        where: {
          addressHash: { in: rows.map(row => lifecycleAddressHash(row.email)) },
        },
        select: { addressHash: true },
        // orderby-exempt: addressHash is a primary key and the candidate snapshot is capped at 10,000 (campaign test).
        take: 10000,
      });
      const blocked = new Set(suppressions.map(row => row.addressHash));
      const eligible = rows.filter(
        row => !blocked.has(lifecycleAddressHash(row.email))
      );
      // Bounded pages keep a large cohort insert below the parameter ceiling.
      for (let offset = 0; offset < eligible.length; offset += 500) {
        await tx.freeEmailEnrollment.createMany({
          data: eligible
            .slice(offset, offset + 500)
            .map(({ accountId, userId }) => ({
              id: randomUUID(),
              accountId,
              userId,
              cohort: 'existing',
              version: FREE_EMAIL_CONFIG.VERSION,
              startedAt: campaign.startedAt ?? now,
            })),
          skipDuplicates: true,
        });
      }
      return tx.emailLifecycleCampaign.update({
        where: { id: campaign.id },
        data: { initializedAt: now },
      });
    },
    { timeout: 25000 }
  );

export const finishFreeEnrollment_IO = async (
  id: string,
  reason: string,
  now = new Date()
): Promise<void> => {
  await DB_CLIENT.use.freeEmailEnrollment.updateMany({
    where: { id, status: 'active' },
    data: { status: 'finished', finishReason: reason, finishedAt: now },
  });
};
