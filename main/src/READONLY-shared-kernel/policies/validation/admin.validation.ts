// DECISION: admin.validation.ts is a BARREL re-exporting the per-subdomain validators
// (admin-users, -logs, -notes, -policies, -rbac, -reports, -runtime-config, -feature-flags, -traits,
// -announcements, -health). `adminValidators` is the spread of ALL per-subdomain validator objects, so
// every method stays available as `adminValidators.<method>` without touching import sites;
// audit:validation checks coverage of every admin endpoint through that name, so the spread must stay
// complete. The split mirrors admin.dto.ts. deleteSession lives in admin-users.validation.ts (session
// revocation is user management; endpoint in web-1/src/domain/user/operations/user-session.operations.ts).
// adminGetUserTimeline/adminGetLogs/adminSendLog live in logs.

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
