import { useEffect, useId, useRef, useState } from 'react';
import { AppLinkAtom as Link } from '../AppLink/AppLink.atom';
import { useTranslations } from 'next-intl';
import { CookieIcon, XIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../Button/Button.atom';
import { TypographyAtom } from '../Typography/Typography.atom';
import { ToggleAtom } from '../Toggle/Toggle.atom';
import { useCookieConsentStore } from '../../../application/stores/cookieConsent.store';
import { useAuth } from '../../contexts/AuthContext.composition';
import { useScrollIntent } from '../../hooks/useScrollIntent';
import styles from './CookieBanner.module.css';

export function CookieBannerOrganism() {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tucked, setTucked] = useState(false);
  const scroll = useScrollIntent();
  // Opt-OUT: analytics is active by default, so its toggle is pre-checked.
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const headingId = useId();
  const categoriesId = useId();
  const t = useTranslations('cookieBanner');
  // „Dostosuj" and „Zwiń" are TWO different buttons swapped in place: a click unmounted the
  // focused button, focus fell to <body> and the keyboard restarted from the top of the page.
  // After the switch focus goes to the button that took its place (only after a user action, not
  // on mount).
  const customizeBtnRef = useRef<HTMLButtonElement>(null);
  const collapseBtnRef = useRef<HTMLButtonElement>(null);
  const toggledByUser = useRef(false);
  useEffect(() => {
    if (!toggledByUser.current) {
      return;
    }
    toggledByUser.current = false;
    (expanded ? collapseBtnRef : customizeBtnRef).current?.focus();
  }, [expanded]);

  const consent = useCookieConsentStore(state => state.consent);
  const acceptAll = useCookieConsentStore(state => state.acceptAll);
  const acceptNecessary = useCookieConsentStore(state => state.acceptNecessary);
  const setConsent = useCookieConsentStore(state => state.setConsent);
  const { isLoggedIn } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Hiding: only the collapsed bar, and only on a downward move away from the top of the page.
  // The expanded panel stays (someone is reading the settings).
  useEffect(() => {
    if (!expanded && scroll.isPastTop && scroll.intent === 'down') {
      setTucked(true);
    }
  }, [expanded, scroll.isPastTop, scroll.intent]);

  const handleSave = () => {
    setConsent({ analytics, marketing });
  };

  const toggleExpanded = () => {
    toggledByUser.current = true;
    setExpanded(prev => !prev);
  };

  // DECISION: the cookie banner shows ONLY to logged-out visitors (the public part of the app).
  // An explicit refusal ("tylko niezbędne") stops further analytics collection (PostHog +
  // GTM/GA4/Clarity).
  if (isLoggedIn) {
    return null;
  }
  // SSR / pre-hydration: render nothing to avoid mismatch.
  if (!mounted) {
    return null;
  }
  // User already decided — banner stays hidden.
  if (consent !== null) {
    return null;
  }

  return (
    <div className={styles.shell} data-expanded={expanded || undefined}>
      <button
        type='button'
        className={styles.tab}
        data-visible={tucked || undefined}
        inert={!tucked}
        aria-label={t('title')}
        onClick={() => setTucked(false)}>
        <CookieIcon size={24} weight='duotone' aria-hidden='true' />
      </button>
      <div
        role='dialog'
        aria-modal='false'
        aria-labelledby={headingId}
        className={styles.banner}
        data-tucked={tucked || undefined}
        inert={tucked}>
        <div
          className={`${styles.inner} ${expanded ? (styles.innerExpanded ?? '') : ''}`}>
          <div className={styles.textCol}>
            <div className={styles.header}>
              <div className={styles.headingRow}>
                <CookieIcon
                  size={24}
                  weight='duotone'
                  className={styles.icon}
                  aria-hidden='true'
                />
                <TypographyAtom
                  variant='h4'
                  id={headingId}
                  className={styles.heading}>
                  {t('title')}
                </TypographyAtom>
              </div>
              {expanded ? (
                <button
                  ref={collapseBtnRef}
                  type='button'
                  aria-label={t('collapseAriaLabel')}
                  aria-expanded='true'
                  aria-controls={categoriesId}
                  className={styles.closeBtn}
                  onClick={toggleExpanded}>
                  <XIcon size={20} aria-hidden='true' />
                </button>
              ) : (
                // Compactness: „Dostosuj" sits in the heading row, not in the actions row, which
                // frees a whole button row (~52px on mobile), and it belongs to the heading
                // semantically (it expands the panel, it does not give consent).
                <button
                  ref={customizeBtnRef}
                  type='button'
                  aria-expanded='false'
                  className={styles.customizeBtn}
                  onClick={toggleExpanded}>
                  {t('actions.customize')}
                </button>
              )}
            </div>

            <TypographyAtom variant='body2' className={styles.description}>
              {t.rich('description', {
                privacyLink: chunks => (
                  <Link
                    prefetch={false}
                    href={ROUTES_FRONT.PRIVACY}
                    className={styles.link}>
                    {chunks}
                  </Link>
                ),
                cookiesLink: chunks => (
                  <Link
                    prefetch={false}
                    href={ROUTES_FRONT.COOKIES}
                    className={styles.link}>
                    {chunks}
                  </Link>
                ),
              })}
            </TypographyAtom>

            {expanded && (
              <div id={categoriesId} className={styles.categories}>
                <div className={styles.category}>
                  <div className={styles.categoryHeader}>
                    <ToggleAtom
                      checked
                      disabled
                      label={t('categories.necessary.label')}
                      aria-label={t('categories.necessary.ariaLabel')}
                    />
                    <TypographyAtom
                      variant='caption'
                      className={styles.alwaysOn}>
                      {t('categories.necessary.alwaysOn')}
                    </TypographyAtom>
                  </div>
                  <TypographyAtom
                    variant='caption'
                    className={styles.categoryDesc}>
                    {t('categories.necessary.description')}
                  </TypographyAtom>
                </div>

                <div className={styles.category}>
                  <div className={styles.categoryHeader}>
                    <ToggleAtom
                      checked={analytics}
                      onChange={e => setAnalytics(e.target.checked)}
                      label={t('categories.analytics.label')}
                    />
                  </div>
                  <TypographyAtom
                    variant='caption'
                    className={styles.categoryDesc}>
                    {t('categories.analytics.description')}
                  </TypographyAtom>
                </div>

                <div className={styles.category}>
                  <div className={styles.categoryHeader}>
                    <ToggleAtom
                      checked={marketing}
                      onChange={e => setMarketing(e.target.checked)}
                      label={t('categories.marketing.label')}
                    />
                  </div>
                  <TypographyAtom
                    variant='caption'
                    className={styles.categoryDesc}>
                    {t('categories.marketing.description')}
                  </TypographyAtom>
                </div>
              </div>
            )}
          </div>

          <div className={styles.actions}>
            {expanded ? (
              <>
                <ButtonAtom
                  variant='text'
                  size='md'
                  onClick={acceptNecessary}
                  className={styles.actionBtn}>
                  {t('actions.acceptNecessary')}
                </ButtonAtom>
                <ButtonAtom
                  variant='primary'
                  size='md'
                  onClick={handleSave}
                  className={styles.actionBtn}>
                  {t('actions.save')}
                </ButtonAtom>
              </>
            ) : (
              <>
                <ButtonAtom
                  variant='text'
                  size='md'
                  onClick={acceptNecessary}
                  className={styles.actionBtn}>
                  {t('actions.acceptNecessary')}
                </ButtonAtom>
                <span className={styles.acceptNudge}>
                  <ButtonAtom
                    variant='primary'
                    size='md'
                    onClick={acceptAll}
                    className={styles.actionBtn}>
                    {t('actions.acceptAll')}
                  </ButtonAtom>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
