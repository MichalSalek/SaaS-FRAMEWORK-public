// DECISION (nie usuwaj tego komentarza):
// admin.dto.ts is now a barrel that re-exports all admin subdomain DTOs.
// Split per-subdomain (admin-users.dto.ts, admin-announcements.dto.ts, etc.)
// preserves 100% transparency for importers — ADMIN_DTO_API_V1 composed via
// type intersection of partial API types. All named exports remain available
// from this module without any import-site changes.
// Refactored in dedicated session (#C-architecture-6a). admin.validation.ts
// is a separate file — not touched here (#C-architecture-7).

export * from './admin-logs.dto';
export * from './admin-users.dto';
export * from './admin-notes.dto';
export * from './admin-policies.dto';
export * from './admin-traits.dto';
export * from './admin-announcements.dto';
export * from './admin-feature-flags.dto';
export * from './admin-runtime-config.dto';
export * from './admin-reports.dto';
export * from './admin-rbac.dto';
export * from './admin-ai-crawler.dto';
export * from './admin-health.dto';
export * from './admin-attention.dto';
export * from './admin-mailing.dto';

import type { AdminLogsDtoApi } from './admin-logs.dto';
import type { AdminUsersDtoApi } from './admin-users.dto';
import type { AdminNotesDtoApi } from './admin-notes.dto';
import type { AdminPoliciesDtoApi } from './admin-policies.dto';
import type { AdminTraitsDtoApi } from './admin-traits.dto';
import type { AdminAnnouncementsDtoApi } from './admin-announcements.dto';
import type { AdminFeatureFlagsDtoApi } from './admin-feature-flags.dto';
import type { AdminRuntimeConfigDtoApi } from './admin-runtime-config.dto';
import type { AdminReportsDtoApi } from './admin-reports.dto';
import type { AdminRbacDtoApi } from './admin-rbac.dto';
import type { AdminAiCrawlerDtoApi } from './admin-ai-crawler.dto';
import type { AdminHealthDtoApi } from './admin-health.dto';
import type { AdminAttentionDtoApi } from './admin-attention.dto';
import type { AdminMailingDtoApi } from './admin-mailing.dto';

// ADMIN_DTO_API_V1 composed from per-subdomain partial API types.
// Intersection preserves the identical shape for all consumers.
export type ADMIN_DTO_API_V1 = AdminHealthDtoApi &
  AdminUsersDtoApi &
  AdminNotesDtoApi &
  AdminPoliciesDtoApi &
  AdminLogsDtoApi &
  AdminTraitsDtoApi &
  AdminAnnouncementsDtoApi &
  AdminFeatureFlagsDtoApi &
  AdminRuntimeConfigDtoApi &
  AdminReportsDtoApi &
  AdminRbacDtoApi &
  AdminAiCrawlerDtoApi &
  AdminAttentionDtoApi &
  AdminMailingDtoApi;
