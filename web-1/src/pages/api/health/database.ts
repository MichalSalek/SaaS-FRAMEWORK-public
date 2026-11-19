// DECISION: Better Stack monitors this stable path before the endpoint rollout: an old deploy returns a
// DB-less 404 (an honest DOWN during an outage) and a new one starts reporting the passive state of the
// main pool by itself. The alias runs no SQL of its own and removes the manual "enable the monitor after
// deploy" runbook step. The route path also lives as the constant `HEALTH_ROUTE_ALIASES.DATABASE`
// (application/health/health-route-aliases.ts), which hooks the alias into the strict rate-limit tier;
// moving or renaming this file means updating that constant (a test guards it).
export { default } from '../v1/internal/health-public';
