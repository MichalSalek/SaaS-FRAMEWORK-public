import { TurnstileWidgetAtom } from '../../../components/Turnstile/TurnstileWidget.atom';
import { isTurnstileEnabled } from '../../../../application/security/turnstile.config';

import { type ReactNode, type SyntheticEvent, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { CheckboxAtom } from '../../../components/Checkbox/Checkbox.atom';
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
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetNonce, setCaptchaResetNonce] = useState(0);
  const [email, setEmail] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  // Active front-end validation instead of a dead disabled: the button is
  // ENABLED, and a click with an empty/bad field gives a message + shake (a better
  // „lure” than a dimmed button without feedback; owner).
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

    // E-mail validation through the SHARED validator (kernel regex, no drift
    // from the backend). Empty -> „Wpisz adres e-mail”, bad format -> „Podaj poprawny…”.
    const emailError = emailFieldError(email, {
      required: tv('errorEmptyEmail'),
      invalid: tv('errorInvalidEmail'),
    });
    if (emailError !== undefined) {
      triggerError(emailError);
      return;
    }

    if (requiresConsent && !consentGiven) {
      triggerError(tv('errorConsentRequired'));
      return;
    }
    // Anti-bot: signing up requires a TRUSTED user interaction (trusted-interaction
    // SSOT): a bot rendering JS without input events will not inflate double-opt-in
    // mails. A real user who typed the e-mail has it anyway (silent return).
    if (!hasTrustedInteraction() || isPending) {
      return;
    }
    if (isTurnstileEnabled() && !captchaToken) {
      triggerError(errorMessage);
      return;
    }
    setValidationError(null);
    subscribeMutation.mutate(
      {
        email: email.trim(),
        consentSource,
        ...(captchaToken ? { turnstile_token: captchaToken } : {}),
      },
      {
        // A newsletter signup is an acquired lead, like the contact form: GA4
        // `generate_lead`. `consentSource` says where in the site it came from,
        // so a blog signup can be told from a footer one instead of one number
        // without context.
        onSuccess: () => trackNewsletterSignup(consentSource),
        onSettled: () => {
          if (isTurnstileEnabled()) {
            setCaptchaToken(null);
            setCaptchaResetNonce(n => n + 1);
          }
        },
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

  // One error slot: front-end validation FIRST, then the server's rejection
  // (mutually exclusive in practice: validation blocks the submit).
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
        <TurnstileWidgetAtom
          onToken={setCaptchaToken}
          resetNonce={captchaResetNonce}
        />
        {errorBlock}
        {/* The shared checkbox, not a bare native one: that was 13 px wide on
            every public page (the layout probe's oldest tap-target entry). */}
        {requiresConsent && (
          <CheckboxAtom
            id={consentId}
            {...(classNames.consent !== undefined
              ? { className: classNames.consent }
              : {})}
            checked={consentGiven}
            onChange={e => setConsentGiven(e.target.checked)}
            disabled={isPending}
            required
            aria-required='true'>
            <span className={classNames.consentText}>{consentLabel}</span>
          </CheckboxAtom>
        )}
        {privacyNote !== undefined && (
          <p className={classNames.privacyNote}>{privacyNote}</p>
        )}
      </form>
    </>
  );
}
