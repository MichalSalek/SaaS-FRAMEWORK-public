import {
  validateEmail,
  validateByMinLength,
  validateByMaxLength,
  isValidNip,
} from '@kernel/policies/validation/validation.utils';
import { VALIDATION_REGEX } from '@kernel/policies/validation.config';

// Thin field validators for manual (non-RHF-resolver) forms — each returns the
// caller-supplied i18n message when invalid, else `undefined`. Messages stay at
// the call site (i18n), while the RULES come from the shared-kernel custom
// validators (the SAME email regex / length predicates the backend enforces) so
// the frontend never re-implements a divergent check. Extend existing usage;
// this is not a new validation framework.

/** Required: non-empty after trim. */
export function requiredFieldError(
  value: string,
  message: string
): string | undefined {
  return value.trim() ? undefined : message;
}

/**
 * Email: required + kernel `validateEmail` (VALIDATION_REGEX.EMAIL). Replaces
 * per-form inline email regexes that drift from the kernel rule.
 */
export function emailFieldError(
  value: string,
  messages: { required: string; invalid: string }
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return messages.required;
  }
  return validateEmail(trimmed) ? undefined : messages.invalid;
}

/** Min length (kernel `validateByMinLength`). Empty fails — pair with required. */
export function minLengthFieldError(
  value: string,
  min: number,
  message: string
): string | undefined {
  return validateByMinLength(value.trim(), min) ? undefined : message;
}

/** Max length (kernel `validateByMaxLength`). Empty passes. */
export function maxLengthFieldError(
  value: string,
  max: number,
  message: string
): string | undefined {
  return validateByMaxLength(value.trim(), max) ? undefined : message;
}

/**
 * Polish NIP: required + kernel `isValidNip` (normalizacja + checksum modulo 11 —
 * TEN SAM algorytm co backend `vatInvoiceDetailsSchema`, zero rozjazdu client↔server).
 */
export function nipFieldError(
  value: string,
  messages: { required: string; invalid: string }
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return messages.required;
  }
  return isValidNip(trimmed) ? undefined : messages.invalid;
}

/**
 * Polish postal code (NN-NNN): required + kernel `POSTAL_CODE_PL` regex — the same
 * shape the backend `vatInvoiceDetailsSchema` enforces (country always PL).
 */
export function postalCodePlFieldError(
  value: string,
  messages: { required: string; invalid: string }
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return messages.required;
  }
  return VALIDATION_REGEX.POSTAL_CODE_PL.test(trimmed)
    ? undefined
    : messages.invalid;
}
