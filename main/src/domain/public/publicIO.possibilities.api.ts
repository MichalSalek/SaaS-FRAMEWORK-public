import { contractEndpoint } from '../../application/http/io';
import { PUBLIC_CONTRACTS } from '@kernel/domain/public/public.contracts';
import { APPLICATION_CONTRACTS } from '@kernel/domain/application/application.contracts';

const P = PUBLIC_CONTRACTS;

export const submitContactForm_IO = contractEndpoint(P.CONTACT_FORM_SUBMIT);
export const getPublicStylistsList_IO = contractEndpoint(
  P.GET_PUBLIC_STYLISTS_LIST
);

// Public no-auth GET. Fail-soft lives in the hook; the IO is transport.
// `background` suppresses the per-XHR snackbar during an outage.
export const getPublicRuntimeConfig_IO = contractEndpoint(
  APPLICATION_CONTRACTS.GET_RUNTIME_CONFIG_PUBLIC,
  { errorFeedbackPolicy: 'background' }
);
