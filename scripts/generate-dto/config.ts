// Configuration for Prisma-to-DTO generator
// SSOT for type mappings, name overrides, and special field handling

/** Prisma scalar type → TypeScript type mapping */
export const PRISMA_TYPE_MAP: Record<string, string> = {
  'Int': 'number',
  'String': 'string',
  'Boolean': 'boolean',
  'Float': 'number',
  'DateTime': 'DateAndTime',
  'Json': 'Record<string, unknown>',
  'BigInt': 'bigint',
  'Decimal': 'number',
  'Bytes': 'Buffer',
}

/** Prisma model name → DTO type name (when different) */
export const MODEL_NAME_OVERRIDES: Record<string, string> = {
  'Role': 'RoleEntity',
  'Permission': 'PermissionEntity',
  'RolePermission': 'RolePermissionEntity',
}

/** Enums to skip (defined elsewhere, not in db_models.generated.dto.ts) */
export const SKIP_ENUMS: ReadonlySet<string> = new Set([
  'PricingPlan', // Defined in .shared-kernel/domain/pricing/pricing.config.ts
])

/**
 * Field type overrides for specific model.field combinations.
 * Use when Prisma scalar type doesn't match the desired DTO type.
 * Format: { ModelName: { fieldName: 'DTOType' } }
 */
export const FIELD_TYPE_OVERRIDES: Record<string, Record<string, string>> = {
  'Trait': {
    'category': 'TraitCategory', // Prisma String → TraitCategory (literal union)
  },
  'StylistAccount': {
    'email_preferences': 'EmailPreferences', // Prisma Json? → EmailPreferences (structured type from email.dto.ts)
  },
  'EventLog': {
    'event': 'EVENTS_ALL_TYPE', // Prisma String → APP_EVENTS literal union (kernel SSOT)
  },
  'Permission': {
    'event_name': 'EVENT_COMMANDS_AND_QUERIES_TYPE', // Permissions are seeded ONLY from EVENTS config
    'category': 'GROUP_KEY', // Category derives from COMMANDS/QUERIES groups (cqrs.types)
  },
  'Announcement': {
    'type': 'AnnouncementType', // info | warning | critical (admin.dto.ts)
  },
  'RuntimeConfig': {
    'value_type': 'RuntimeConfigValueType', // string | number | boolean | json (runtime-config.config.ts)
  },
  'DeletedUser': {
    'body': 'DeletedUserBackup', // Prisma Json → DeletedUserBackup (structured type from recovery)
  },
  'AiCrawlerEvent': {
    'bot_category': 'AiCrawlerBotCategory', // Prisma String? → AiCrawlerBotCategory union (kernel SSOT)
  },
  'User': {
    'role_id': 'SystemRoleIdType', // Prisma String FK → SystemRoleIdType (kernel SSOT). Roles seeded ONLY from SystemRoleId (permissions.seed.ts) — User.role_id can only be one of 4 system role IDs.
  },
  'ContactAccessLog': {
    'access_type': 'ContactAccessType', // Prisma String → ContactAccessType union (VIEW_CONTACT | EXPORT_CONTACT, contact-access.types.ts)
  },
  'NewsletterConsentEvent': {
    'action': 'NewsletterConsentAction', // Prisma String → SUBSCRIBE | UNSUBSCRIBE (newsletter-consent.types.ts)
  },
  'StaffMember': {
    'permissions': 'StaffPermission', // Prisma String[] → StaffPermission[] (generator appends []). Source: staff_accounts.config.ts
  },
}

/**
 * External type imports needed by the generated file.
 * All imports use `import type` to avoid runtime circular dependencies.
 */
export const GENERATED_FILE_IMPORTS: ReadonlyArray<{types: string[]; from: string; comment?: string}> = [
  {types: ['IDType', 'IDStringType', 'DateAndTime'], from: '../application/application.types'},
  {types: ['ValueOf'], from: '../application/application.utils'},
  {types: ['PricingPlan'], from: '../domain/pricing/pricing.config'},
  {types: ['DateMetadata', 'DateMetadataWithUpdate', 'TraitCategory', 'SystemRoleIdType'], from: './db_models.manual.dto'},
  {types: ['EmailPreferences'], from: './email/email.dto'},
  {types: ['EVENTS_ALL_TYPE', 'EVENT_COMMANDS_AND_QUERIES_TYPE', 'GROUP_KEY'], from: '../domain/commands-and-queries/cqrs.types'},
  {types: ['AnnouncementType'], from: './admin/admin.dto'},
  {types: ['RuntimeConfigValueType'], from: '../domain/admin/runtime-config.config'},
  {types: ['DeletedUserBackup'], from: '../domain/recovery/deleted-user-backup.types'},
  {types: ['AiCrawlerBotCategory'], from: '../domain/seo/ai-crawler-detection'},
  {types: ['ContactAccessType'], from: '../domain/contact/contact-access.types'},
  {types: ['NewsletterConsentAction'], from: '../domain/newsletter/newsletter-consent.types'},
  {types: ['StaffPermission'], from: '../domain/user-and-account/staff_accounts.config'},
]

/** Regex patterns for detecting ID-like fields (non-@id foreign keys) */
export const ID_FIELD_PATTERNS: ReadonlyArray<RegExp> = [
  /_id$/,   // created_by_user_id, gallery_record_id, etc.
  /Id$/,    // userId, accountId, providerId
]

/** Prisma scalar types that can represent ID/FK fields */
export const ID_CAPABLE_SCALAR_TYPES: ReadonlySet<string> = new Set(['Int', 'String'])
