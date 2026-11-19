import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';

const C = ADMIN_CONTRACTS;

export const adminTickDebugSwitch_IO = contractEndpoint(
  C.SWITCH_BACKEND_DEBUG_MODE
);
export const adminGetHealth_IO = contractEndpoint(C.ADMIN_HEALTH);
export const adminGetMetrics_IO = contractEndpoint(C.ADMIN_GET_METRICS);
