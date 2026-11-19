import { contractEndpoint, defineEndpoint } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import { EMAIL_CONTRACTS } from '@kernel/domain/email/email.contracts';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';

const C = EMAIL_CONTRACTS;

// POST, not GET: the backend GET path is a pure 302 redirect to the branded
// frontend page (footer-link click). The mutation is the raw protocol in
// raw-protocols.ts, so it stays a hand-typed call.
export const emailUnsubscribe_IO = defineEndpoint<
  EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['REQUEST'],
  EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['RESPONSE'],
  EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.EMAIL_UNSUBSCRIBE,
  mode: 'post',
  errorFeedbackPolicy: 'background',
});

export const getEmailSchedule_IO = contractEndpoint(C.EMAIL_GET_SCHEDULE);
export const updateEmailPreferences_IO = contractEndpoint(
  C.EMAIL_UPDATE_PREFERENCES
);
export const recordLifecycleEntry_IO = contractEndpoint(
  C.EMAIL_LIFECYCLE_ENTRY,
  { errorFeedbackPolicy: 'background' }
);
export const getLifecycleActions_IO = contractEndpoint(
  C.EMAIL_LIFECYCLE_ACTIONS,
  { errorFeedbackPolicy: 'background' }
);
