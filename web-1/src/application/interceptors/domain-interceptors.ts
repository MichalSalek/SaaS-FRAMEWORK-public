// Application->domain barrel: the one import point for request middleware (current user and
// permissions interceptors) and for the domain-owned periodic jobs that
// application/scheduler/scheduled-jobs.registry.ts registers.

export {
  getCurrentUser_IO,
  getCurrentUserUndefinedReturnObject,
} from '@domain/user/operations/user-session.operations';
export type {
  GetCurrentUserOutput,
  GetCurrentUserOutputOptimistic,
} from '@domain/user/user.types';
export { isUserShouldBeOnThisRoutePermissionsInterceptor } from '@domain/permissions/routing-permissions.interceptor';
export { eventLogCleanupJob } from '@domain/admin/event-log-cleanup.interceptor';
export { aiCrawlerCleanupJob } from '@domain/admin/ai-crawler-cleanup.interceptor';
export { impersonationBackupCleanupJob } from '@domain/admin/impersonation-backup-cleanup.interceptor';
export { recoveryExpiryJob } from '@domain/admin/recovery-expiry.interceptor';
export { featureFlagExpiryJob } from '@domain/admin/feature-flag-expiry.interceptor';
export { newsletterPendingCleanupJob } from '@domain/newsletter/newsletter-pending-cleanup.interceptor';
export { notificationCleanupJob } from '@domain/notifications/notification-cleanup.interceptor';

export { sessionActivityOutboxJob } from '@domain/session-container/session-activity.job';
