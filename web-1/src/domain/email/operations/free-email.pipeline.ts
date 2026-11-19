import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import type {
  AdminFreeEmailPipeline,
  AdminLifecycleEmailReport,
} from '@kernel/models/admin/admin-mailing.dto';
import { getFreeEmailPreview_IO } from './free-email.operation';

/** Aggregate acceptance and delivery independently: absent delivery is unknown, never delivered. */
export const lifecycleEmailCounts = (
  groups: readonly {
    status: string;
    deliveryStatus: string | null;
    count: number;
  }[]
) => ({
  accepted: groups
    .filter(row => row.status === 'accepted')
    .reduce((sum, row) => sum + row.count, 0),
  delivered: groups
    .filter(row => row.deliveryStatus === 'delivered')
    .reduce((sum, row) => sum + row.count, 0),
  delayed: groups
    .filter(row => row.deliveryStatus === 'delayed')
    .reduce((sum, row) => sum + row.count, 0),
  bounced: groups
    .filter(row => row.deliveryStatus === 'bounced')
    .reduce((sum, row) => sum + row.count, 0),
  complained: groups
    .filter(row => row.deliveryStatus === 'complained')
    .reduce((sum, row) => sum + row.count, 0),
  unknown: groups
    .filter(row => ['unknown', 'sending'].includes(row.status))
    .reduce((sum, row) => sum + row.count, 0),
  rejected: groups
    .filter(row => row.status === 'rejected')
    .reduce((sum, row) => sum + row.count, 0),
  suppressed: groups
    .filter(row => row.status === 'suppressed')
    .reduce((sum, row) => sum + row.count, 0),
});

export const getFreePipeline_IO = async (
  now: Date
): Promise<AdminFreeEmailPipeline> => {
  const [{ campaign, candidates }, enrolled] = await Promise.all([
    getFreeEmailPreview_IO(now),
    DB_CLIENT.use.freeEmailEnrollment.count(),
  ]);
  const mode = campaign?.mode;
  return {
    mode: mode === 'ON' || mode === 'PREVIEW' ? mode : 'OFF',
    startedAt: campaign?.startedAt?.toISOString() ?? null,
    initializedAt: campaign?.initializedAt?.toISOString() ?? null,
    enrolled,
    candidates: candidates.map(({ enrollment, audience, decision }) => ({
      enrollmentId: enrollment.id,
      userId: audience?.account.created_by_user_id ?? enrollment.userId ?? '',
      email: audience?.account.created_by_user.email ?? '',
      cohort: enrollment.cohort,
      plannedAt:
        'plannedAt' in decision
          ? (decision.plannedAt?.toISOString() ?? null)
          : null,
      templateId:
        decision.kind === 'send'
          ? decision.templateId
          : audience && decision.kind !== 'finish'
            ? audience.state.visiblePhotoCount === 0
              ? 'free-first-photo'
              : audience.state.visiblePinnedCount === 0
                ? 'free-public-profile'
                : 'free-first-client'
            : null,
      decision: decision.kind,
      reason:
        decision.kind === 'send'
          ? campaign?.mode === 'ON'
            ? 'ready'
            : 'preview_only'
          : decision.reason,
    })),
  };
};
export const getLifecycleEmailReport_IO = async (
  now: Date
): Promise<AdminLifecycleEmailReport> => {
  const since = new Date(now.getTime() - 7 * TIME.MS_PER_DAY);
  const [groups, messages] = await Promise.all([
    DB_CLIENT.use.emailLifecycleMessage.groupBy({
      by: ['status', 'deliveryStatus'],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
    DB_CLIENT.use.emailLifecycleMessage.findMany({
      where: { createdAt: { gte: since } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    }),
  ]);
  return {
    since: since.toISOString(),
    ...lifecycleEmailCounts(
      groups.map(row => ({
        status: row.status,
        deliveryStatus: row.deliveryStatus,
        count: row._count,
      }))
    ),
    history: messages.map(row => ({
      id: row.id,
      ruleId: row.ruleId,
      family: row.family,
      cohort: row.cohort,
      locale: row.locale,
      provider: row.provider,
      status: row.status,
      deliveryStatus: row.deliveryStatus,
      plannedAt: row.scheduledAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      reason: row.reason,
    })),
  };
};
