import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';

export const adminGetAttentionCounts_IO = contractEndpoint(
  ADMIN_CONTRACTS.ADMIN_GET_ATTENTION_COUNTS
);
