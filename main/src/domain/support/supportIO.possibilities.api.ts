import { contractEndpoint } from '../../application/http/io';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';

// Every support call is derived from its kernel contract (URL, method, request and response).
// Per-call options (successFeedback, silentBusinessError, abort) stay on the promise function.
// The `_IO` names are kept for the existing hooks.
const C = SUPPORT_CONTRACTS;

export const createSupportThread_IO = contractEndpoint(C.SUPPORT_CREATE_THREAD);
export const addSupportMessage_IO = contractEndpoint(C.SUPPORT_ADD_MESSAGE);
export const getSupportThreads_IO = contractEndpoint(C.SUPPORT_GET_MY_THREADS);
export const getSupportThreadMessages_IO = contractEndpoint(
  C.SUPPORT_GET_THREAD_MESSAGES
);
export const getSupportUnreadCount_IO = contractEndpoint(
  C.SUPPORT_GET_UNREAD_COUNT
);
export const markSupportThreadRead_IO = contractEndpoint(
  C.SUPPORT_MARK_THREAD_READ
);
export const adminGetSupportThreads_IO = contractEndpoint(
  C.SUPPORT_ADMIN_GET_ALL_THREADS
);
export const adminGetSupportThreadMessages_IO = contractEndpoint(
  C.SUPPORT_ADMIN_GET_THREAD_MESSAGES
);
export const adminReplyToSupportThread_IO = contractEndpoint(
  C.SUPPORT_ADMIN_REPLY
);
export const changeSupportThreadStatus_IO = contractEndpoint(
  C.SUPPORT_CHANGE_STATUS
);
