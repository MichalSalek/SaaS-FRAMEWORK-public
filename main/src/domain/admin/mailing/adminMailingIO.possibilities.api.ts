import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';

const C = ADMIN_CONTRACTS;

export const adminGetEmailPreview_IO = contractEndpoint(
  C.ADMIN_GET_EMAIL_PREVIEW
);
export const adminGetEmailPipeline_IO = contractEndpoint(
  C.ADMIN_GET_EMAIL_PIPELINE
);
export const adminGetEmailHistory_IO = contractEndpoint(
  C.ADMIN_GET_EMAIL_HISTORY
);
