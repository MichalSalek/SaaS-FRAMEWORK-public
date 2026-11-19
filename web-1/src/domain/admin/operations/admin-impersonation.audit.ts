import type { IDType } from '@kernel/application/application.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

export const impersonationAuditRow = ({
  adminUserId,
  payload,
}: {
  adminUserId: IDType;
  payload: Record<string, unknown>;
}) => ({
  eventLogType: EventLogTypeValue.ADMIN,
  meta: {
    created_by_user_id: adminUserId,
    impersonated_by_admin_id: adminUserId,
  },
  eventPayloadToStringify: payload,
});
