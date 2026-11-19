// Contact form errors (kernel `ContactError`; its EXTERNAL_SERVICE_ERROR is owned by the common map).
import type { ContactError } from '@kernel/domain/contact/contact-errors.types';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';
import { respondOpaqueFailure } from './shared.responders';

export const contactErrorMap = {
  // Misconfiguration, already logged server-side; the client gets the generic error.
  CONTACT_FORM_NO_ADMIN_EMAIL: respondOpaqueFailure,
} satisfies ErrorResponderMap<OwnErrors<ContactError>>;
