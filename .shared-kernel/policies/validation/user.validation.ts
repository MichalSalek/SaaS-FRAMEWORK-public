import type { z } from 'zod';
import type { USER_DTO_API_V1 } from '../../models/user/user.dto';
import {
  emptyCommandBody,
  userChangeEmailSchema,
  userChangeNameSchema,
  userCheckRecoverySchema,
  userOnboardAsClientSchema,
  userOnboardAsStylistSchema,
  userSwitchRoleSchema,
  userUpdateNotificationPreferencesSchema,
} from '../../domain/user/user.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const userValidators = {
  userChangeEmail: (data: unknown) => zodValidate(userChangeEmailSchema, data),
  userChangeName: (data: unknown) => zodValidate(userChangeNameSchema, data),
  userOnboardAsStylist: (data: unknown) =>
    zodValidate(userOnboardAsStylistSchema, data),
  userOnboardAsClient: (data: unknown) =>
    zodValidate(userOnboardAsClientSchema, data),

  // Bodyless endpoints (userId from the session, or a GET with no payload).
  // The contract body is the same empty object, so a missing or garbage body still parses as {}.
  deleteOrDisableSelfUser: (data: unknown) =>
    zodValidate(emptyCommandBody, data),
  userGetAccountState: (data: unknown) => zodValidate(emptyCommandBody, data),
  userGetUsageStats: (data: unknown) => zodValidate(emptyCommandBody, data),
  userRestoreAccount: (data: unknown) => zodValidate(emptyCommandBody, data),
  userReactivateAccount: (data: unknown) => zodValidate(emptyCommandBody, data),
  userGdprErase: (data: unknown) => zodValidate(emptyCommandBody, data),

  userSwitchRole: (data: unknown) => zodValidate(userSwitchRoleSchema, data),
  userCheckRecovery: (data: unknown) =>
    zodValidate(userCheckRecoverySchema, data),
  userUpdateNotificationPreferences: (data: unknown) =>
    zodValidate(userUpdateNotificationPreferencesSchema, data),
} as const;

// One property per validator that has a request field shape. Bodyless endpoints stay unbound.
export type UserRequestSchemaBindings = {
  userChangeEmail: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userChangeEmailSchema>,
      USER_DTO_API_V1['USER_REQUEST_EMAIL_CHANGE']['REQUEST']
    >
  >;
  userChangeName: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userChangeNameSchema>,
      USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST']
    >
  >;
  userOnboardAsStylist: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userOnboardAsStylistSchema>,
      USER_DTO_API_V1['USER_ONBOARD_AS_STYLIST']['REQUEST']
    >
  >;
  userOnboardAsClient: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userOnboardAsClientSchema>,
      USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['REQUEST']
    >
  >;
  userSwitchRole: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userSwitchRoleSchema>,
      USER_DTO_API_V1['USER_SWITCH_ROLE']['REQUEST']
    >
  >;
  userCheckRecovery: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userCheckRecoverySchema>,
      USER_DTO_API_V1['USER_CHECK_RECOVERY']['REQUEST']
    >
  >;
  userUpdateNotificationPreferences: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof userUpdateNotificationPreferencesSchema>,
      USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['REQUEST']
    >
  >;
};
