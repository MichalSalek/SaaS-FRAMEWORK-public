// UI/features/shared/newsletter/NewsletterInlineForm.tsx
// Shared newsletter subscription form — the SINGLE implementation for all
// newsletter signup surfaces (blog, public footer, home lead collector).
// Accepts display text as props — callers pass translated strings, no new i18n keys needed.
// Uses useNewsletterSubscribe (TQ v5 mutation) — actually calls the API.
// CSS classes are passed via classNames prop so each page controls visual presentation.
//
// Flexibility contract:
// - `consentSource` is REQUIRED — every surface must self-identify so the
//   backend can persist consent_source (GDPR consent context).
// - `consentLabel` (ReactNode, e.g. t.rich with a privacy-policy link) turns on
//   the GDPR consent checkbox which gates submit (footer/home behavior).
// - `inputVariant`: 'native' = bare <input> with sr-only label (blog),
//   'field' = shared <Input> component (footer / home).
// - `renderSuccess` / `renderError` slots let callers keep bespoke markup
//   (e.g. footer's <Typography>); defaults render a plain <p>.
//
// Generic VALIDATION messages (empty / invalid email / consent) are the ONE
// exception to "callers pass strings": they are identical across every surface,
// so the form owns them via the shared `newsletterForm` namespace (NOT the
// kernel `validation.*` namespace, which is bound to backend validators).

import { type ReactNode, type SyntheticEvent, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { emailFieldError } from '../../../../application/forms/fieldValidators';
import { useNewsletterSubscribe } from './hooks/useNewsletterSubscribe';
import { hasTrustedInteraction } from '../../../shared/interaction/trusted-interaction';
import { trackNewsletterSignup } from '../../../../application/analytics/cta-events';

/* ─── Props ─── */

interface NewsletterInlineFormClassNames {
  form?: string;
  /** When set, input + CTA are wrapped in a row container (footer/home layout). */
  row?: string;
  inputWrap?: string;
  input?: string;
  submitButton?: string;
  consent?: string;
  consentText?: string;
  privacyNote?: string;
  successMessage?: string;
  errorMessage?: string;
  srOnly?: string;
}

export interface NewsletterInlineFormProps {
  placeholder: string;
  /** aria-label for the 'field' input variant; defaults to `placeholder`. */
  inputAriaLabel?: string;
  ctaLabel: string;
  successMessage: string;
  errorMessage: string;
  /** Persisted as consent_source on the subscriber row, e.g. 'blog' | 'footer' | 'home-lead-collector'. */
  consentSource: string;
  privacyNote?: string;
  /** Rendered above the form and hidden together with it after success. */
  heading?: ReactNode;
  /** When provided, renders a consent checkbox that gates submit. */
  consentLabel?: ReactNode;
  ctaIcon?: ReactNode;
  inputVariant?: 'native' | 'field';
  renderSuccess?: (message: string) => ReactNode;
  renderError?: (message: string) => ReactNode;
  classNames: NewsletterInlineFormClassNames;
}

/* ─── Component ─── */

export function NewsletterInlineFormOrganism({
  placeholder,
  inputAriaLabel,
  ctaLabel,
  successMessage,
  errorMessage,
  consentSource,
  privacyNote,
  heading,
  consentLabel,
  ctaIcon,
  inputVariant = 'native',
  renderSuccess,
  renderError,
  classNames,
}: NewsletterInlineFormProps) {
  const inputId = useId();
  const consentId = useId();
  const tv = useTranslations('newsletterForm');
  const [email, setEmail] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  // Aktywna walidacja frontendowa zamiast martwego disabled: przycisk jest
  // ODBLOKOWANY, a klik z pustym/złym polem daje komunikat + shake (lepsza
  // „wędka" niż przygaszony guzik bez feedbacku — owner 2026-07-19).
  const [validationError, setValidationError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const subscribeMutation = useNewsletterSubscribe();

  const requiresConsent = consentLabel !== undefined;
  const isPending = subscribeMutation.isPending;

  const triggerError = (message: string) => {
    setValidationError(message);
    setShake(true);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (validationError !== null) {
      setValidationError(null);
    }
  };

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Walidacja email przez WSPÓLNY validator (kernel regex — zero rozjazdu
    // z backendem). Pusty → „Wpisz adres e-mail", zły format → „Podaj poprawny…".
    const emailError = emailFieldError(email, {
      required: tv('errorEmptyEmail'),
      invalid: tv('errorInvalidEmail'),
    });
    if (emailError !== undefined) {
      triggerError(emailError);
      return;
    }
    // Zgoda RODO nadal wymagana na consent-gated powierzchniach — ale zamiast
    // cicho blokować disabled, dajemy aktywny komunikat + shake.
    if (requiresConsent && !consentGiven) {
      triggerError(tv('errorConsentRequired'));
      return;
    }
    // Anty-bot: zapis wymaga ZAUFANEJ interakcji usera (trusted-interaction
    // SSOT) — bot renderujący JS bez input-eventów nie nabije wysyłek maili
    // double-opt-in. Realny user po wpisaniu maila i tak ją ma (cichy return).
    if (!hasTrustedInteraction() || isPending) {
      return;
    }
    setValidationError(null);
    subscribeMutation.mutate(
      { email: email.trim(), consentSource },
      {
        // Zapis na newsletter to pozyskany lead, tak samo jak formularz
        // kontaktowy — w GA4 `generate_lead`. `consentSource` mówi, z którego
        // miejsca w serwisie przyszedł, więc da się odróżnić zapis z bloga od
        // zapisu ze stopki, zamiast mieć jedną liczbę bez kontekstu.
        onSuccess: () => trackNewsletterSignup(consentSource),
      }
    );
  };

  if (subscribeMutation.isSuccess) {
    return renderSuccess ? (
      <>{renderSuccess(successMessage)}</>
    ) : (
      <p className={classNames.successMessage} role='status'>
        {successMessage}
      </p>
    );
  }

  // Jeden slot błędu: walidacja frontendowa PIERWSZA, potem odrzucenie serwera
  // (wykluczają się w praktyce — walidacja blokuje submit).
  const displayError =
    validationError ?? (subscribeMutation.isError ? errorMessage : null);

  const inputField =
    inputVariant === 'field' ? (
      <InputAtom
        type='email'
        placeholder={placeholder}
        aria-label={inputAriaLabel ?? placeholder}
        value={email}
        onChange={e => handleEmailChange(e.target.value)}
        className={classNames.input}
        disabled={isPending}
        required
        autoComplete='email'
      />
    ) : (
      <label className={classNames.inputWrap}>
        <span className={classNames.srOnly}>{placeholder}</span>
        <input
          id={inputId}
          type='email'
          value={email}
          onChange={e => handleEmailChange(e.target.value)}
          placeholder={placeholder}
          className={classNames.input}
          required
          aria-required='true'
          disabled={isPending}
          autoComplete='email'
        />
      </label>
    );

  /* DECISION (nie usuwaj tego komentarza):
   * Przycisk newslettera jest CELOWO odblokowany (disabled tylko podczas
   * wysyłki). Zastąpił dawny stan „disabled przed zgodą/emailem" (głos ownera
   * 2026-07-19: martwy przygaszony guzik = słaba wędka). Zamiast disable:
   * aktywna walidacja frontendowa (pusty/zły email, brak zgody) → komunikat
   * inline + poziomy shake (ButtonAtom `shake`). Zgoda RODO NADAL wymagana do
   * wysyłki (blokujemy `mutate`, nie tylko wygląd) — GDPR opt-in nienaruszony.
   * NIE przywracaj `disabled` na email/consent. */
  const submitButton = (
    <ButtonAtom
      type='submit'
      variant='primary'
      size='md'
      className={classNames.submitButton ?? ''}
      loading={isPending}
      shake={shake}
      onShakeEnd={() => setShake(false)}
      {...(ctaIcon !== undefined ? { icon: ctaIcon } : {})}>
      {ctaLabel}
    </ButtonAtom>
  );

  const errorBlock =
    displayError !== null ? (
      renderError ? (
        renderError(displayError)
      ) : (
        <p className={classNames.errorMessage} role='alert'>
          {displayError}
        </p>
      )
    ) : null;

  return (
    <>
      {heading}
      <form className={classNames.form} onSubmit={handleSubmit} noValidate>
        {classNames.row !== undefined ? (
          <div className={classNames.row}>
            {inputField}
            {submitButton}
          </div>
        ) : (
          <>
            {inputField}
            {submitButton}
          </>
        )}
        {errorBlock}
        {requiresConsent && (
          <label htmlFor={consentId} className={classNames.consent}>
            <input
              id={consentId}
              type='checkbox'
              checked={consentGiven}
              onChange={e => setConsentGiven(e.target.checked)}
              disabled={isPending}
              required
              aria-required='true'
            />
            <span className={classNames.consentText}>{consentLabel}</span>
          </label>
        )}
        {privacyNote !== undefined && (
          <p className={classNames.privacyNote}>{privacyNote}</p>
        )}
      </form>
    </>
  );
}
