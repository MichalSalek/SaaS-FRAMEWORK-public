/**
 * EmailUnsubscribePage — magic-link target from the email footer.
 *
 * Calls the public unsubscribe endpoint with the token from the URL.
 * No auth required (the token itself is the proof). Four states:
 *   - noToken: URL did not carry a token (most likely manual visit).
 *   - loading: token present, request in flight.
 *   - success: user has been removed from the list.
 *   - error: token expired, invalid, or already-unsubscribed.
 *
 * The editorial card renders on the IDLE state too (with a small spinner) instead of plain
 * "Initializing...": the page never looks unbranded on first paint, and idle lasts only until
 * router.isReady.
 */

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { useRouter } from 'next/router';
import {
  ArrowClockwiseIcon,
  CheckIcon,
  EnvelopeOpenIcon,
  HouseIcon,
  SpinnerGapIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type {
  EmailInvalidUnsubscribeTokenError,
  EmailTransactionalNotUnsubscribableError,
  EmailUnsubscribeTokenExpiredError,
} from '@kernel/domain/email/email-errors.types';
import { usePublicContact } from '../../components/Pii/usePublicContact';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { isIOError } from '../../../application/http/toPromise.adapter';
import { emailUnsubscribe_IO } from '../../../domain/email/emailIO.possibilities.api';
import { PublicLayoutComposition } from '../../layouts/PublicLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import styles from './EmailUnsubscribePage.module.css';
import { useUnsubscribeOnce } from './useUnsubscribeOnce';

/* ─── Types ─── */

type UnsubscribeStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * The link itself is the problem (the backend's machine-readable
 * `data.error`): every retry fails the same way, so these errors get their own
 * copy and no retry button. Anything else (network, server) stays retryable.
 */
type LinkErrorType =
  | EmailInvalidUnsubscribeTokenError['type']
  | EmailUnsubscribeTokenExpiredError['type']
  | EmailTransactionalNotUnsubscribableError['type'];

const LINK_ERROR_MESSAGE_KEYS: Readonly<
  Record<
    LinkErrorType,
    'errorTokenExpired' | 'errorTokenInvalid' | 'errorTransactional'
  >
> = {
  EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED: 'errorTokenExpired',
  EMAIL_INVALID_UNSUBSCRIBE_TOKEN: 'errorTokenInvalid',
  EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE: 'errorTransactional',
};

const isLinkErrorType = (value: string): value is LinkErrorType =>
  Object.hasOwn(LINK_ERROR_MESSAGE_KEYS, value);

/** `data.error` of the unsubscribe 400 envelope, when present. */
function readLinkErrorType(err: unknown): LinkErrorType | null {
  if (!isIOError(err)) {
    return null;
  }
  const data: unknown = err.httpError.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string' &&
    isLinkErrorType(data.error)
  ) {
    return data.error;
  }
  return null;
}

/* ─── Status card sub-components ─── */

function IdleState() {
  const t = useTranslations('pages.emailUnsubscribe');
  return (
    <div className={styles.statusCard} role='status' aria-live='polite'>
      <span className={styles.iconMedallion}>
        <SpinnerGapIcon
          size={44}
          weight='duotone'
          className={styles.iconSpinner}
          aria-hidden='true'
        />
      </span>
      <h1 className={styles.title}>{t('initializingTitle')}</h1>
      <p className={styles.subtitle}>{t('initializingBody')}</p>
    </div>
  );
}

function LoadingState() {
  const t = useTranslations('pages.emailUnsubscribe');
  return (
    <div className={styles.statusCard} role='status' aria-live='polite'>
      <span className={styles.iconMedallion}>
        <SpinnerGapIcon
          size={44}
          weight='duotone'
          className={styles.iconSpinner}
          aria-hidden='true'
        />
      </span>
      <h1 className={styles.title}>{t('loadingTitle')}</h1>
      <p className={styles.subtitle}>{t('loadingBody')}</p>
    </div>
  );
}

function SuccessState() {
  const t = useTranslations('pages.emailUnsubscribe');
  // EXPLORE_ENABLED (kernel default OFF): the "explore gallery" link targets the
  // parked /app/explore route (404). Hide it while off — the primary "back home"
  // CTA already gives a path. Runtime-reactive: returns when admin enables.
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  return (
    <div className={styles.statusCard} role='status' aria-live='polite'>
      <span className={styles.iconMedallion}>
        <CheckIcon
          size={48}
          weight='bold'
          className={styles.iconSuccess}
          aria-hidden='true'
        />
      </span>
      <h1 className={styles.title}>{t('successTitle')}</h1>
      <p className={styles.subtitle}>{t('successBody')}</p>
      <p className={styles.resubscribeNote}>
        {/* The copy promises the way back is "your account": the marketing
            toggle lives on the account screen (EmailPrefsSection), so the link
            goes there (a guest lands on login first), not to the home page. */}
        {t.rich('resubscribeNote', {
          link: chunks => (
            <Link
              href={ROUTES_FRONT.USER_ACCOUNT}
              className={styles.resubscribeLink}>
              {chunks}
            </Link>
          ),
        })}
      </p>
      <div className={styles.actions}>
        <LinkButtonAtom
          href={ROUTES_FRONT.HOME}
          variant='primary'
          size='md'
          icon={<HouseIcon size={16} />}>
          {t('backHome')}
        </LinkButtonAtom>
        {exploreEnabled && (
          <LinkButtonAtom
            href={ROUTES_FRONT.EXPLORE}
            variant='outlined'
            size='md'
            icon={<EnvelopeOpenIcon size={16} />}>
            {t('exploreGallery')}
          </LinkButtonAtom>
        )}
      </div>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  const t = useTranslations('pages.emailUnsubscribe');
  return (
    <div className={styles.statusCard} role='alert'>
      <span className={`${styles.iconMedallion} ${styles.iconErrorMedallion}`}>
        <WarningIcon
          size={44}
          weight='duotone'
          className={styles.iconError}
          aria-hidden='true'
        />
      </span>
      <h1 className={styles.title}>{t('errorTitle')}</h1>
      <p className={styles.subtitle}>{message}</p>
      <div className={styles.actions}>
        {onRetry && (
          <ButtonAtom
            variant='outlined'
            size='md'
            icon={<ArrowClockwiseIcon size={16} />}
            onClick={onRetry}>
            {t('retry')}
          </ButtonAtom>
        )}
        <LinkButtonAtom
          href={ROUTES_FRONT.HOME}
          variant='primary'
          size='md'
          icon={<HouseIcon size={16} />}>
          {t('backHome')}
        </LinkButtonAtom>
      </div>
    </div>
  );
}

function NoTokenState() {
  const t = useTranslations('pages.emailUnsubscribe');
  return (
    <div className={styles.statusCard} role='alert'>
      <span className={`${styles.iconMedallion} ${styles.iconErrorMedallion}`}>
        <WarningIcon
          size={44}
          weight='duotone'
          className={styles.iconError}
          aria-hidden='true'
        />
      </span>
      <h1 className={styles.title}>{t('noTokenTitle')}</h1>
      <p className={styles.subtitle}>{t('noTokenBody')}</p>
      <div className={styles.actions}>
        <LinkButtonAtom
          href={ROUTES_FRONT.HOME}
          variant='primary'
          size='md'
          icon={<HouseIcon size={16} />}>
          {t('backHome')}
        </LinkButtonAtom>
      </div>
    </div>
  );
}

/* ─── Main page component ─── */

export function EmailUnsubscribePageComposition() {
  const contact = usePublicContact('support');
  const t = useTranslations('pages.emailUnsubscribe');
  const router = useRouter();

  const [status, setStatus] = useState<UnsubscribeStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>(() =>
    t('defaultError')
  );
  // An expired or invalid token fails the same way on every attempt, so its
  // error offers no retry (the copy already points to support); only a
  // generic failure (network, server) is worth another try.
  const [canRetry, setCanRetry] = useState(true);

  // Guard: fire only once per token (router.query is undefined on first render in SSG pages)
  const hasFired = useRef(false);

  const runUnsubscribe = (token: string) => {
    setStatus('loading');
    emailUnsubscribe_IO({ token })
      .then(() => {
        setStatus('success');
      })
      .catch((err: unknown) => {
        // Backend POST error envelope: { event: VALIDATION_FAILED, data: { error: <DomainError type> } }.
        // The specific type lives in httpError.data.error (kernel email-errors.types),
        // NOT in err.message (which carries the generic envelope event).
        // A transactional-category link used to fall through to the generic,
        // retryable copy: "try again" on a request that can never succeed.
        const linkError = readLinkErrorType(err);
        setErrorMessage(
          linkError !== null
            ? t(LINK_ERROR_MESSAGE_KEYS[linkError])
            : t('errorGeneric')
        );
        setCanRetry(linkError === null);
        setStatus('error');
      });
  };

  useUnsubscribeOnce({
    router,
    hasFired,
    runUnsubscribe,
    onNoToken: () => setStatus('idle'), // renders NoTokenState via guard below
    t,
  });

  /* ─── Render ─── */

  const token = router.isReady
    ? (() => {
        const tokenQuery = router.query['token'];
        return Array.isArray(tokenQuery) ? tokenQuery[0] : tokenQuery;
      })()
    : undefined;

  const isNoToken = router.isReady && !token;

  const handleRetry = () => {
    if (token) {
      hasFired.current = true;
      runUnsubscribe(token);
    }
  };

  return (
    <PublicLayoutComposition>
      <div className={styles.page}>
        <div className={styles.container}>
          {isNoToken && <NoTokenState />}
          {!isNoToken && status === 'idle' && <IdleState />}
          {!isNoToken && status === 'loading' && <LoadingState />}
          {!isNoToken && status === 'success' && <SuccessState />}
          {!isNoToken && status === 'error' && (
            <ErrorState
              message={errorMessage}
              {...(canRetry ? { onRetry: handleRetry } : {})}
            />
          )}

          {/* Support strip — visible under the card on every state */}
          <p className={styles.supportStrip}>
            {t.rich('supportStrip', {
              link: chunks => (
                <a
                  href={contact.withSubject(t('supportEmailSubject'))}
                  className={styles.supportLink}>
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    </PublicLayoutComposition>
  );
}
