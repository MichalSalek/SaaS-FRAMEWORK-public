import type { ExternalServiceError } from '../../application/common-errors.types';

export type ContactFormConfigError = {
  type: 'CONTACT_FORM_NO_ADMIN_EMAIL';
};

export type ContactError = ContactFormConfigError | ExternalServiceError;
