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
import styles from './CookieBanner.module.css';

/**
 * CookieBanner — GDPR / RODO consent banner.
 *
 * Visibility:
 *  - Renders only when `consent === null` (user has not yet decided).
 *  - Uses `mounted` gate to avoid SSR hydration mismatch (Zustand persist
 *    rehydrates on the client only).
 *
 * UX:
 *  - Collapsed: 3 actions — Accept all / Only necessary / Customize.
 *  - Expanded (Customize): 3 toggles (necessary disabled+checked, analytics,
 *    marketing) and a "Save selection" button.
 *
 * Model:
 *  - Kategoria `analytics` jest wstępnie zaznaczona (pre-checked). „Tylko
 *    niezbędne" ją wyłącza. Marketing = false (brak pikseli reklamowych).
 *  - Links to /privacy and /cookies visible in collapsed and expanded view.
 *  - Decision persists via Zustand `persist` middleware (localStorage).
 */
export function CookieBannerOrganism() {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Toggle analityki wstępnie zaznaczony.
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const headingId = useId();
  const categoriesId = useId();
  const t = useTranslations('cookieBanner');
  // „Dostosuj" i „Zwiń" to DWA różne przyciski podmieniane w miejscu: klik
  // odmontowywał przycisk z fokusem, fokus spadał na <body> i klawiatura
  // zaczynała od początku strony. Po przełączeniu fokus trafia na przycisk,
  // który zajął jego miejsce (tylko po akcji użytkownika, nie przy montażu).
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

  const handleSave = () => {
    setConsent({ analytics, marketing });
  };

  const toggleExpanded = () => {
    toggledByUser.current = true;
    setExpanded(prev => !prev);
  };

  // DECISION (nie usuwaj tego komentarza):
  // Banner cookies pokazujemy TYLKO dla niezalogowanych (publiczna część app).
  // Jawne odrzucenie („tylko niezbędne") wyłącza dalsze zbieranie analityki
  // (PostHog + GTM/GA4/Clarity).
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
    <div
      role='dialog'
      aria-modal='false'
      aria-labelledby={headingId}
      className={styles.banner}>
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
              // Kompaktowość: „Dostosuj" siedzi w wierszu nagłówka, nie w rzędzie
              // akcji — odzyskuje cały wiersz przycisku (~52px na mobile), a
              // semantycznie należy do nagłówka (rozwija panel, nie wyraża zgody).
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
                  <TypographyAtom variant='caption' className={styles.alwaysOn}>
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
                variant='outlined'
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
                variant='outlined'
                size='md'
                onClick={acceptNecessary}
                className={styles.actionBtn}>
                {t('actions.acceptNecessary')}
              </ButtonAtom>
              <ButtonAtom
                variant='primary'
                size='md'
                onClick={acceptAll}
                className={styles.actionBtn}>
                {t('actions.acceptAll')}
              </ButtonAtom>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
