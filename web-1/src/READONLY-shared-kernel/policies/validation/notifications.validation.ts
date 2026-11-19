import type { z } from 'zod';
import type { NOTIFICATIONS_DTO_API_V1 } from '../../models/notifications/notifications.dto';
import {
  notificationsMarkReadSchema,
  pushSubscriptionRegisterSchema,
  pushSubscriptionUnregisterSchema,
} from '../../domain/notifications/notifications.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const notificationsValidators = {
  notificationsMarkRead: (data: unknown) =>
    zodValidate(notificationsMarkReadSchema, data),
  pushSubscriptionRegister: (data: unknown) =>
    zodValidate(pushSubscriptionRegisterSchema, data),
  pushSubscriptionUnregister: (data: unknown) =>
    zodValidate(pushSubscriptionUnregisterSchema, data),
} as const;

export type NotificationsRequestSchemaBindings = {
  notificationsMarkRead: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof notificationsMarkReadSchema>,
      NOTIFICATIONS_DTO_API_V1['NOTIFICATIONS_MARK_READ']['REQUEST']
    >
  >;
  pushSubscriptionRegister: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pushSubscriptionRegisterSchema>,
      NOTIFICATIONS_DTO_API_V1['PUSH_SUBSCRIPTION_REGISTER']['REQUEST']
    >
  >;
  pushSubscriptionUnregister: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pushSubscriptionUnregisterSchema>,
      NOTIFICATIONS_DTO_API_V1['PUSH_SUBSCRIPTION_UNREGISTER']['REQUEST']
    >
  >;
};
