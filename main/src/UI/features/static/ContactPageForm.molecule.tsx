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
 * Visual frame: tonal surface card (paper bg, full hairline border na 4 bokach)
 * — no shadow, no one-sided accent (S21: złoty top-bar usunięty, floor 7×ZERO).
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
  // Sukces zastępuje formularz: aktywny element (przycisk „Wyślij") znika z DOM,
  // więc fokus spadał na <body>, a czytnik nie słyszał potwierdzenia. Panel jest
  // regionem statusu, a fokus ląduje na jego tytule.
  const successTitleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (submitted) {
      successTitleRef.current?.focus();
    }
  }, [submitted]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  // Error-shake na przycisku wyślij (walidacja pól lub odrzucenie serwera) —
  // reużywalny ButtonAtom `shake`.
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
    // Twarda ifka anty-bot: `disabled` na przycisku to tylko UX — bot, który
    // wywoła submit programatycznie (form.submit()/dispatchEvent), utknie tu.
    // Ostateczną ścianą jest weryfikacja Turnstile po stronie web-1.
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
      // Token Turnstile jest jednorazowy — po KAŻDEJ próbie (sukces/fail)
      // resetujemy widget; ponowna wysyłka wymaga świeżego tokenu.
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
          {/* Etykieta sekcji = ten formTitle (S24: markery-dividery nad
              sekcjami usunięte — tytuł sekcji żyje W sekcji); bez pill-kickera. */}
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
          {/* DECISION (nie usuwaj tego komentarza):
              Mobile <768px: full-width INLINE submit (celowo NIE sticky) —
              page-level StickyCtaBar pokrywa stickiness konwersji, drugi
              sticky w karcie by z nim kolidował. Patrz DECISION przy
              .submitRow w ContactPage.module.css. */}
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
              // Błędy walidacji NIE blokują przycisku: po dotknięciu jednego pola
              // przycisk gasł, zanim nietknięte pola pokazały, czego brakuje, a
              // Enter w polu (niejawne wysłanie) na wyłączonym przycisku nic nie
              // robił. Klik/Enter uruchamia handleSubmit, który zaznacza
              // wszystkie pola, pokazuje błędy i trzęsie przyciskiem.
              disabled={
                isSubmitting ||
                !trusted ||
                (isTurnstileEnabled() && !captchaToken)
              }
              shake={shake}
              onShakeEnd={() => setShake(false)}
              aria-busy={isSubmitting}>
              <PaperPlaneRightIcon
                size={18}
                weight='regular'
                aria-hidden='true'
              />
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
