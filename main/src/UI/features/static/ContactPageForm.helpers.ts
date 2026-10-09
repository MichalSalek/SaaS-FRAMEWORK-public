/**
 * ContactPageForm — czysta logika formularza (typy, walidacja, narrowing topic).
 * Wydzielone z ContactPageForm.molecule.tsx (max-lines): zero JSX, zero stanu.
 */
import type { ContactFormTopic } from '@kernel/models/public/public.dto';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import {
  requiredFieldError,
  emailFieldError,
  minLengthFieldError,
  maxLengthFieldError,
} from '../../../application/forms/fieldValidators';

export interface ContactFormValues {
  name: string;
  topic: ContactFormTopic | '';
  email: string;
  message: string;
}

export interface ContactFormErrors {
  name?: string | undefined;
  topic?: string | undefined;
  email?: string | undefined;
  message?: string | undefined;
}

export const EMPTY_CONTACT_FORM: ContactFormValues = {
  name: '',
  topic: '',
  email: '',
  message: '',
};

/**
 * Allowed topic values, mirrored from the <Select> options in the molecule.
 * Derived from a Record keyed by the kernel union, so BOTH kinds of drift are
 * compile errors: an unknown value (excess key) AND a kernel topic missing
 * here (missing key). A plain `satisfies readonly ContactFormTopic[]` only
 * caught the first one — a new kernel topic would silently never reach the
 * select.
 */
const CONTACT_TOPIC_REGISTRY: Record<ContactFormTopic, true> = {
  stylistka: true,
  klientka: true,
  cennik: true,
  bug: true,
  wspolpraca: true,
  inne: true,
};
export const CONTACT_TOPIC_VALUES = Object.keys(
  CONTACT_TOPIC_REGISTRY
) as readonly ContactFormTopic[];

/** Type-guard: narrows a raw select value to a known ContactFormTopic. */
export function isContactFormTopic(value: string): value is ContactFormTopic {
  return (CONTACT_TOPIC_VALUES as readonly string[]).includes(value);
}

/**
 * Narrows a raw select value to ContactFormTopic | ''. Unknown values collapse
 * to '' (unselected), preserving the controlled-input contract without a cast.
 */
export function toContactFormTopic(value: string): ContactFormTopic | '' {
  return isContactFormTopic(value) ? value : '';
}

type Translator = (key: string) => string;

/**
 * Rules sourced from the shared-kernel (validateEmail / length predicates +
 * VALIDATION_LENGTHS) — no per-form inline email regex or magic numbers.
 */
export function validateContactForm(
  values: ContactFormValues,
  t: Translator
): ContactFormErrors {
  const errors: ContactFormErrors = {};
  const nameError =
    requiredFieldError(values.name, t('form.validation.nameRequired')) ??
    maxLengthFieldError(
      values.name,
      VALIDATION_LENGTHS.CONTACT_NAME_MAX,
      t('form.validation.nameTooLong')
    );
  if (nameError) {
    errors.name = nameError;
  }
  if (!values.topic) {
    errors.topic = t('form.validation.topicRequired');
  }
  const emailError = emailFieldError(values.email, {
    required: t('form.validation.emailRequired'),
    invalid: t('form.validation.emailInvalid'),
  });
  if (emailError) {
    errors.email = emailError;
  }
  const messageError =
    requiredFieldError(values.message, t('form.validation.messageRequired')) ??
    minLengthFieldError(
      values.message,
      VALIDATION_LENGTHS.CONTACT_MESSAGE_MIN,
      t('form.validation.messageTooShort')
    ) ??
    maxLengthFieldError(
      values.message,
      VALIDATION_LENGTHS.CONTACT_MESSAGE_MAX,
      t('form.validation.messageTooLong')
    );
  if (messageError) {
    errors.message = messageError;
  }
  return errors;
}
