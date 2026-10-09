// DECISION (nie usuwaj tego komentarza):
// C-architecture-6b DONE: admin.validation.ts to teraz BARREL re-eksportujacy
// walidatory per-subdomena (admin-users.validation.ts, admin-logs.validation.ts,
// admin-notes.validation.ts, admin-policies.validation.ts, admin-rbac.validation.ts,
// admin-reports.validation.ts, admin-runtime-config.validation.ts,
// admin-feature-flags.validation.ts, admin-traits.validation.ts,
// admin-announcements.validation.ts, admin-health.validation.ts).
// Transparency twarda: `adminValidators` = spread WSZYSTKICH per-subdomain validator-objektow,
// wiec komplet metod jest obecny pod `adminValidators.<metoda>` bez zmiany zadnego import-site.
// audit:validation sprawdza coverage kazdego admin-endpointu po `adminValidators.<metoda>` —
// spread musi pozostac kompletny. Podzial per-subdomena odwzorowuje admin.dto.ts (#C-architecture-6a).
//
// deleteSession trafil do admin-users.validation.ts (revocation sesji = user-management,
// endpoint w web-1/src/domain/user/operations/user-session.operations.ts; brak osobnej
// subdomeny sessions w DTO). adminGetUserTimeline/adminGetLogs/adminSendLog -> logs
// (typy w admin-logs.dto.ts). Zero zmian w zachowaniu walidatorow — czysty split strukturalny.

import { adminAnnouncementsValidators } from './admin-announcements.validation';
import { adminFeatureFlagsValidators } from './admin-feature-flags.validation';
import { adminHealthValidators } from './admin-health.validation';
import { adminLogsValidators } from './admin-logs.validation';
import { adminNotesValidators } from './admin-notes.validation';
import { adminPoliciesValidators } from './admin-policies.validation';
import { adminRbacValidators } from './admin-rbac.validation';
import { adminReportsValidators } from './admin-reports.validation';
import { adminRuntimeConfigValidators } from './admin-runtime-config.validation';
import { adminTraitsValidators } from './admin-traits.validation';
import { adminUsersValidators } from './admin-users.validation';

export { adminUsersValidators } from './admin-users.validation';
export { adminLogsValidators } from './admin-logs.validation';
export { adminNotesValidators } from './admin-notes.validation';
export { adminPoliciesValidators } from './admin-policies.validation';
export { adminRbacValidators } from './admin-rbac.validation';
export { adminReportsValidators } from './admin-reports.validation';
export { adminRuntimeConfigValidators } from './admin-runtime-config.validation';
export { adminFeatureFlagsValidators } from './admin-feature-flags.validation';
export { adminTraitsValidators } from './admin-traits.validation';
export { adminAnnouncementsValidators } from './admin-announcements.validation';
export { adminHealthValidators } from './admin-health.validation';

export const adminValidators = {
  ...adminUsersValidators,
  ...adminLogsValidators,
  ...adminNotesValidators,
  ...adminPoliciesValidators,
  ...adminRbacValidators,
  ...adminReportsValidators,
  ...adminRuntimeConfigValidators,
  ...adminFeatureFlagsValidators,
  ...adminTraitsValidators,
  ...adminAnnouncementsValidators,
  ...adminHealthValidators,
} as const;
