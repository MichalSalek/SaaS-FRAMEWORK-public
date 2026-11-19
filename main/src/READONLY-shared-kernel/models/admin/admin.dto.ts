// <contracts:manual>
import type { APPLICATION_DTO_API_V1 } from '../application/application.dto';
import type { USER_DTO_API_V1 } from '../user/user.dto';

// DECISION: these operations are declared on the user and application contracts. The admin DTO
// keeps the old names as aliases of those contract types, so admin screens and the request
// bindings still index one type. The shape is not a second schema.
export type ADMIN_DTO_API_V1_EXTRA = {
  USER_DELETE_ANY: USER_DTO_API_V1['USER_DELETE_ANY'];
  USER_DISABLE_ANY: USER_DTO_API_V1['USER_DISABLE_ANY'];
  USER_ENABLE_ANY: USER_DTO_API_V1['USER_ENABLE_ANY'];
  ANNOUNCEMENTS_GET_ACTIVE: APPLICATION_DTO_API_V1['ANNOUNCEMENTS_GET_ACTIVE'];
  GET_RUNTIME_CONFIG_PUBLIC: APPLICATION_DTO_API_V1['GET_RUNTIME_CONFIG_PUBLIC'];
};

// Helper types stay on the subdomain files. ADMIN_DTO_API_V1 below is the contract view.

export * from './admin-logs.dto';
export * from './admin-users.dto';
export * from './admin-announcements.dto';
export * from './admin-feature-flags.dto';
export * from './admin-runtime-config.dto';
export * from './admin-reports.dto';
export * from './admin-health.dto';
export * from './admin-attention.dto';
export * from './admin-mailing.dto';

// ADMIN_DTO_API_V1 composed from per-subdomain partial API types.
// Intersection preserves the identical shape for all consumers.
// </contracts:manual>

import type { ADMIN_DTO_API_V1_PART_1 } from './admin-part-1.dto';
import type { ADMIN_DTO_API_V1_PART_2 } from './admin-part-2.dto';

export type ADMIN_DTO_API_V1 = ADMIN_DTO_API_V1_PART_1 &
  ADMIN_DTO_API_V1_PART_2 &
  ADMIN_DTO_API_V1_EXTRA;
