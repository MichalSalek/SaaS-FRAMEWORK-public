// web-1/src/application/auth/better-auth/user-fields.config.ts
//
// Columns of the `users` table that Better Auth must know about beyond its core. Split out of
// better-auth.config.ts so they can run in a test without building the whole `auth` instance
// (env, DB client, Apple JWT signing).

import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

/**
 * DECISION: the `defaultValue` on `role_id` is NOT decoration. Without it OAuth sign-up fails
 * before anything reaches the DB.
 *
 * On the OAuth sign-up path Better Auth calls `parseAdditionalUserInputFromProviderProfile(...,
 * 'create')` (dist/oauth2/link-account.mjs) BEFORE the `databaseHooks.user.create.before` hook
 * that stamps the role. `parseInputData` checks `defaultValue` first, then `required`; a provider
 * profile never carries `role_id`, so without a default it throws and the callback redirects with
 * `?error=role_id_is_required`. Magic-link is immune (`internalAdapter.createUser`).
 *
 * The default is the LOWEST role (CLIENT_ROLE), a safety net: the real role comes from the
 * `create.before` hook (admin allow-list -> MASTER_ADMIN), which overwrites it. `required: true`
 * STAYS: `required: false` would add `| undefined | null` to the session types.
 */
export const USER_ADDITIONAL_FIELDS = {
  role_id: {
    type: 'string',
    required: true,
    input: false,
    defaultValue: SystemRoleId.CLIENT_ROLE,
  },
  account_type: {
    type: 'string',
    required: false,
    defaultValue: AccountTypeValue.CLIENT,
    input: false,
  },
  is_active: {
    type: 'boolean',
    required: false,
    defaultValue: true,
    input: false,
  },
  moderation_strikes: {
    type: 'number',
    required: false,
    defaultValue: 0,
    input: false,
  },
  notifications_enabled: {
    type: 'boolean',
    required: false,
    defaultValue: true,
    input: false,
  },
} as const;
