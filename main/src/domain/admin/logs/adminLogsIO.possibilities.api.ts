// IO functions for admin logs and observability (frontend client).
// Every call is derived from its kernel contract. The `_IO` names are kept.

import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';

const C = ADMIN_CONTRACTS;

export const adminGetAuditTrail_IO = contractEndpoint(C.ADMIN_GET_AUDIT_TRAIL);
export const adminGetReports_IO = contractEndpoint(C.ADMIN_GET_REPORTS);

// getLogs_IO stays in this module, outside the error-debugger import cycle
// (io.ts -> http.possibilities.api -> errorHandler -> errorHandlerIO -> io.ts).
export const getLogs_IO = contractEndpoint(C.GET_LOGS);
export const adminGetLogDetails_IO = contractEndpoint(C.ADMIN_GET_LOG_DETAILS);
export const adminGetLogGroups_IO = contractEndpoint(C.ADMIN_GET_LOG_GROUPS);
export const adminSetLogIssueStatus_IO = contractEndpoint(
  C.ADMIN_SET_LOG_ISSUE_STATUS
);
export const adminGetAiCrawlerStats_IO = contractEndpoint(
  C.ADMIN_AI_CRAWLER_STATS
);
export const adminGetAiCrawlerList_IO = contractEndpoint(
  C.ADMIN_AI_CRAWLER_LIST
);
