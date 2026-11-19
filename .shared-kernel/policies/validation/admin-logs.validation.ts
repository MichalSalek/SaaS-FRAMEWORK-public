import type { z } from 'zod';
import {
  getLogDetailsSchema,
  getLogGroupsSchema,
  getLogsSchema,
  getUserTimelineRuntimeSchema,
  sendLogSchema,
  setLogIssueStatusSchema,
} from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

// The route GETs stay lenient (QUERY_FIELD). These validators are what the unit tests call,
// and adminSendLog still folds every issue into `__general`.
export const adminLogsValidators = {
  adminSendLog: (data: unknown) =>
    zodValidate(sendLogSchema, data, { routeIssuesToGeneral: true }),
  adminGetUserTimeline: (data: unknown) =>
    zodValidate(getUserTimelineRuntimeSchema, data),
  adminGetLogs: (data: unknown) => zodValidate(getLogsSchema, data),
  adminGetLogDetails: (data: unknown) => zodValidate(getLogDetailsSchema, data),
  adminGetLogGroups: (data: unknown) => zodValidate(getLogGroupsSchema, data),
  adminSetLogIssueStatus: (data: unknown) =>
    zodValidate(setLogIssueStatusSchema, data),
} as const;

export type AdminLogsRequestSchemaBindings = {
  adminSendLog: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sendLogSchema>,
      ADMIN_DTO_API_V1['SEND_LOG']['REQUEST']
    >
  >;
  adminSetLogIssueStatus: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof setLogIssueStatusSchema>,
      ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['REQUEST']
    >
  >;
};
