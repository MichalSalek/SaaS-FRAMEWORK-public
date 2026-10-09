// DECISION (nie usuwaj tego komentarza):
// Application→domain barrel: aggregator dla request middleware i schedulera
// lazy-maintenance.
// Wszystkie interceptors (currentUser, permissions, pairingCleanup, emailLifecycle)
// są agregowane TUTAJ, żeby orchestration miała jeden punkt importu.
// Trade-off: jeden barrel vs rozproszone importy w warstwie HTTP.

export {
  getCurrentUser_IO,
  getCurrentUserUndefinedReturnObject,
} from '@domain/user/operations/user-session.operations';
export type {
  GetCurrentUserOutput,
  GetCurrentUserOutputOptimistic,
} from '@domain/user/user.types';
export { currentUserEntityInterceptor } from '@domain/user/user.interceptor';
export { isUserShouldBeOnThisRoutePermissionsInterceptor } from '@domain/permissions/routing-permissions.interceptor';
export { pairingCleanupInterceptor } from './pairing-cleanup-interceptor';
export { sessionContainerExpiryInterceptor } from './session-container-expiry-interceptor';
export { emailLifecycleInterceptor } from '@app/email-handler/lifecycle/email-lifecycle.orchestrator';
export { eventLogCleanupInterceptor } from '@domain/admin/event-log-cleanup.interceptor';
export { aiCrawlerCleanupInterceptor } from '@domain/admin/ai-crawler-cleanup.interceptor';
export { newsletterPendingCleanupInterceptor } from '@domain/newsletter/newsletter-pending-cleanup.interceptor';
export { impersonationBackupCleanupInterceptor } from '@domain/admin/impersonation-backup-cleanup.interceptor';
export { stripeEventJanitorInterceptor } from '@app/stripe/webhooks/janitor/stripe-event-janitor.interceptor';
export { stripeCancelReconcileInterceptor } from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.interceptor';
export { recoveryExpiryInterceptor } from '@domain/admin/recovery-expiry.interceptor';
export { featureFlagExpiryInterceptor } from '@domain/admin/feature-flag-expiry.interceptor';
export { exchangeCodeCleanupInterceptor } from '@app/auth/better-auth/exchange-code-cleanup.interceptor';
export { expiredSessionCleanupInterceptor } from './expired-session-cleanup-interceptor';
