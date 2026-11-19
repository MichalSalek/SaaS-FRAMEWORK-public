import { SUPPORT_CONTRACTS } from '../../domain/support/support.contracts';
import { supportThreadIdBody } from '../../domain/support/support.contract-schemas';
import { contractBodyValidator } from './contract.validation';
import { zodValidate } from './validation.zod';

// DECISION: support request schemas live in the API contracts
// (`domain/support/support.contracts.ts`). These names stay as the legacy view (VALIDATION_POLICY,
// characterization tests). `getSupportThreadMessages` is the exception: the GET never ran that
// schema (a missing thread id is `{ thread_id: 'Required' }` from the handler, not an i18n 400),
// so the schema stays beside the contract and is not the route parser.
const C = SUPPORT_CONTRACTS;

export const supportValidators = {
  createSupportThread: contractBodyValidator(C.SUPPORT_CREATE_THREAD.body),
  addSupportMessage: contractBodyValidator(C.SUPPORT_ADD_MESSAGE.body),
  adminSupportReply: contractBodyValidator(C.SUPPORT_ADMIN_REPLY.body),
  getSupportThreadMessages: (data: unknown) =>
    zodValidate(supportThreadIdBody, data),
  markSupportThreadRead: contractBodyValidator(C.SUPPORT_MARK_THREAD_READ.body),
  changeSupportStatus: contractBodyValidator(C.SUPPORT_CHANGE_STATUS.body),
} as const;
