import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PaperPlaneRightIcon, CheckCircleIcon } from '@phosphor-icons/react';
import { submitContactForm_IO } from '../../../domain/public/publicIO.possibilities.api';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import {
  type ContactFormValues,
  type ContactFormErrors,
  EMPTY_CONTACT_FORM,
  isContactFormTopic,
  toContactFormTopic,
  validateContactForm,
} from './ContactPageForm.helpers';
import { InputAtom } from '../../components/Input/Input.atom';
import { SelectAtom } from '../../components/Select/Select.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TurnstileWidgetAtom } from '../../components/Turnstile/TurnstileWidget.atom';
import {
  useTrustedInteraction,
  hasTrustedInteraction,
} from '../../shared/interaction/trusted-interaction';
import { isTurnstileEnabled } from '../../../application/security/turnstile.config';
import styles from './ContactPage.module.css';
import { trackContactFormSubmitted } from '../../../application/analytics/cta-events';

/* ─── ContactPageForm (typy/walidacja/narrowing → ContactPageForm.helpers.ts) ─── */

/**
 * Form card — renders inside ContactPage's split grid (right column).
 * Manages its own state. Submits to /api/v1/public/contact-form.
 *
 * Visual frame: tonal surface card (paper background, full hairline on all four sides),
 * no shadow and no one-sided accent (the gold top bar was removed).
 * On submit success, swaps to a success state with reset CTA.
 */
export function ContactPageFormMolecule() {
  const t = useTranslations('static.contact');

  const TOPIC_OPTIONS = [
    { value: 'stylistka', label: t('form.topics.stylistka') },
    { value: 'klientka', label: t('form.topics.klientka') },
    { value: 'cennik', label: t('form.topics.cennik') },
    { value: 'bug', label: t('form.topics.bug') },
    { value: 'wspolpraca', label: t('form.topics.wspolpraca') },
    { value: 'inne', label: t('form.topics.inne') },
  ];

  const validateForm = (values: ContactFormValues): ContactFormErrors =>
    validateContactForm(values, t);

  const [values, setValues] = useState<ContactFormValues>(EMPTY_CONTACT_FORM);
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [touched, setTouched] = useState<
    Partial<Record<keyof ContactFormValues, boolean>>
  >({});
  const [submitted, setSubmitted] = useState(false);
  // Success replaces the form: the active element (the "Wyślij" button) leaves the DOM,
  // so focus fell on <body> and the screen reader missed the confirmation. The panel is
  // a status region, and focus lands on its title.
  const successTitleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (submitted) {
      successTitleRef.current?.focus();
    }
  }, [submitted]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  // Error shake on the send button (field validation or a server rejection),
  // the shared ButtonAtom `shake`.
  const [shake, setShake] = useState(false);
  // Anty-spam (dwie sumujące się warstwy, patrz trusted-interaction.ts):
  // 1) submit odblokowany dopiero po ZAUFANEJ interakcji usera (isTrusted),
  // 2) Cloudflare Turnstile (by-presence) — token jednorazowy per próba.
  const trusted = useTrustedInteraction();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetNonce, setCaptchaResetNonce] = useState(0);

  const setValue =
    (field: keyof ContactFormValues) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => {
      const next = { ...values, [field]: e.target.value };
      setValues(next);
      if (touched[field]) {
        setErrors(validateForm(next));
      }
    };

  const markTouched = (field: keyof ContactFormValues) => () => {
    setTouched(prev => ({ ...prev, [field]: true }));
    setErrors(validateForm(values));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Hard anti-bot check: `disabled` on the button is only UX. A bot that
    // submits programmatically (form.submit() or dispatchEvent) stops here.
    // The final wall is Turnstile verification in web-1.
    if (!hasTrustedInteraction()) {
      return;
    }
    if (isTurnstileEnabled() && !captchaToken) {
      return;
    }
    setTouched({ name: true, topic: true, email: true, message: true });
    const errs = validateForm(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setShake(true);
      return;
    }
    // validateForm already blocks an empty topic above, so this guard only
    // re-narrows ContactFormTopic | '' -> ContactFormTopic for a cast-free
    // request payload. The early return is logically unreachable here.
    if (!isContactFormTopic(values.topic)) {
      setErrors({ topic: t('form.validation.topicRequired') });
      return;
    }
    setIsSubmitting(true);
    setSubmitFailed(false);
    try {
      await submitContactForm_IO({
        name: values.name,
        topic: values.topic,
        email: values.email,
        message: values.message,
        ...(captchaToken ? { turnstile_token: captchaToken } : {}),
      });
      // Formularz kontaktowy to jedyne miejsce na stronach statycznych, gdzie
      // ktoś zostawia namiary — czyli jedyny realny lead. W GA4 `generate_lead`.
      trackContactFormSubmitted();
      setSubmitted(true);
    } catch {
      // Form-level generic error — never surface raw technical error messages
      // (err.message) to the user; details are reported server-side.
      setSubmitFailed(true);
      setShake(true);
    } finally {
      setIsSubmitting(false);
      // A Turnstile token is single-use. After every attempt (success or failure)
      // reset the widget; another submit needs a fresh token.
      if (isTurnstileEnabled()) {
        setCaptchaToken(null);
        setCaptchaResetNonce(n => n + 1);
      }
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setValues(EMPTY_CONTACT_FORM);
    setErrors({});
    setTouched({});
    setSubmitFailed(false);
  };

  return (
    <div className={styles.formCard}>
      {submitted ? (
        <div className={styles.successPanel} role='status'>
          <div className={styles.successHaloWrap} aria-hidden='true'>
            <div className={styles.successHalo} />
            <CheckCircleIcon
              size={48}
              weight='regular'
              className={styles.successIcon}
              aria-hidden='true'
            />
          </div>
          <h3
            ref={successTitleRef}
            tabIndex={-1}
            className={styles.successTitle}>
            {t('form.successTitle')}
          </h3>
          <p className={styles.successText}>{t('form.successText')}</p>
          <ButtonAtom variant='outlined' size='md' onClick={handleReset}>
            {t('form.successReset')}
          </ButtonAtom>
        </div>
      ) : (
        <form
          onSubmit={e => {
            void handleSubmit(e);
          }}
          className={styles.form}
          noValidate>
          {/* The section label is this formTitle (divider markers above sections
              were removed; the section title lives in the section). No pill kicker. */}
          <div className={styles.formHeader}>
            <h2 className={styles.formTitle}>{t('form.title')}</h2>
            <p className={styles.formLede}>{t('form.lede')}</p>
          </div>
          <div className={styles.formFields}>
            <InputAtom
              label={t('form.labelName')}
              placeholder={t('form.placeholderName')}
              value={values.name}
              onChange={setValue('name')}
              onBlur={markTouched('name')}
              error={touched.name ? errors.name : undefined}
              required
              autoComplete='name'
              maxLength={VALIDATION_LENGTHS.CONTACT_NAME_MAX}
            />
            <SelectAtom
              id='contact-topic'
              error={touched.topic ? errors.topic : undefined}
              label={t('form.labelTopic')}
              options={TOPIC_OPTIONS}
              placeholder={t('form.placeholderTopic')}
              value={values.topic}
              onChange={e => {
                const next = {
                  ...values,
                  topic: toContactFormTopic(e.target.value),
                };
                setValues(next);
                if (touched.topic) {
                  setErrors(validateForm(next));
                }
              }}
              onBlur={markTouched('topic')}
              required
            />
            <InputAtom
              label={t('form.labelEmail')}
              type='email'
              placeholder={t('form.placeholderEmail')}
              value={values.email}
              onChange={setValue('email')}
              onBlur={markTouched('email')}
              error={touched.email ? errors.email : undefined}
              required
              autoComplete='email'
              autoCapitalize='none'
              spellCheck={false}
            />
            <InputAtom
              label={t('form.labelMessage')}
              multiline
              placeholder={t('form.placeholderMessage')}
              rows={5}
              value={values.message}
              onChange={setValue('message')}
              onBlur={markTouched('message')}
              error={touched.message ? errors.message : undefined}
              required
              maxLength={VALIDATION_LENGTHS.CONTACT_MESSAGE_MAX}
            />
          </div>
          {/* DECISION: see main/src/UI/features/static/ContactPage.module.css
              (inline, never sticky, mobile submit). */}
          {submitFailed && (
            <p className={styles.fieldError} role='alert'>
              {t('form.errorGeneric')}
            </p>
          )}
          <TurnstileWidgetAtom
            onToken={setCaptchaToken}
            resetNonce={captchaResetNonce}
          />
          <div className={styles.submitRow}>
            <ButtonAtom
              type='submit'
              variant='primary'
              size='lg'
              className={styles.submitButton}
              // Validation errors do not disable the button: after one field was touched
              // the button went dead before the untouched fields showed what was missing, and
              // Enter in a field (implicit submit) on a disabled button did nothing.
              // Click or Enter runs handleSubmit, which marks every field, shows the errors
              // and shakes the button.
              disabled={
                isSubmitting ||
                !trusted ||
                (isTurnstileEnabled() && !captchaToken)
              }
              shake={shake}
              onShakeEnd={() => setShake(false)}
              aria-busy={isSubmitting}
              icon={
                <PaperPlaneRightIcon
                  size={18}
                  weight='regular'
                  aria-hidden='true'
                />
              }>
              {isSubmitting ? t('form.submitBusy') : t('form.submitIdle')}
            </ButtonAtom>
            <p className={styles.submitReassurance}>
              {t('form.submitReassurance')}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
