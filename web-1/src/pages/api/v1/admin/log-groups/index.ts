import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetLogGroups_IO } from '@domain/admin/operations/admin-log-groups.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import {
  parseQueryParams,
  pBool,
  pNarrowed,
} from '@app/http/parse-query-params';
import {
  isLogApplication,
  isLogEnvironment,
} from '@kernel/domain/admin/log-triage.config';
import { isSendLogType } from '@kernel/domain/admin/send-log.config';

type RequestParams = ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['REQUEST'];

const LOG_GROUPS_QUERY_SCHEMA = {
  environment: pNarrowed(isLogEnvironment),
  application: pNarrowed(isLogApplication),
  type: pNarrowed(isSendLogType),
  // true = the list behind the menu badge; the operation then replaces the
  // three dimensions above with the kernel scope (LOG_ATTENTION_SCOPE).
  attention: pBool,
} satisfies Record<keyof RequestParams, unknown>;

export default defineHandler<
  RequestParams,
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_LOG_GROUPS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const body = parseQueryParams<RequestParams>(
      req.query,
      LOG_GROUPS_QUERY_SCHEMA
    );

    const result = await adminGetLogGroups_IO({ body, currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.LOG_GROUPS_FETCHED);
  },
});
