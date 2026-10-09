// UI/components/TrialCountdownBanner/TrialCountdownBanner.tsx
// Trial-to-paid conversion nudge: shown when ≤7 days remain on the Pro trial.
// Loss aversion framing — surfacing what will be lost, not what will be gained.
// Three urgency tiers: mild (4-7 days), urgent (1-3 days), lastDay (<24 h).
// Stack: CSS Modules + Phosphor Icons + next-intl.

import { useState, useEffect } from 'react';
import { TIME } from '@kernel/application/constants.config';
import { useTranslations } from 'next-intl';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { XIcon, ClockAfternoonIcon } from '@phosphor-icons/react';
import {
  getSessionStorage,
  setSessionStorage,
} from '../../../application/client-device-storage/session-storage-adapter/sessionStorage.adapter';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import { ButtonAtom } from '../Button/Button.atom';
import { resolveTrialCountdown } from './trialCountdown.logic';
import styles from './TrialCountdownBanner.module.css';

// DECISION (nie usuwaj tego komentarza):
// Threshold: ≤7 days. Rationale — behavioral research shows loss-aversion urgency
// kicks in at ~1 week remaining. Showing the banner too early (>7 days) dilutes
// urgency and causes banner blindness. Showing it too late (<1 day) gives the user
// no time to act. The 7-day window balances visibility with urgency.
// daysRemaining ≤ 0 is intentionally excluded — an expired trial is a separate
// conversion flow (force-gated UI or upgrade modal), not a countdown banner.

// DECISION (nie usuwaj tego komentarza):
// Dismissed banner per SESSION (sessionStorage), nie permanently (localStorage).
// Trial countdown urgency MUST resurface w nowej sesji — user który dismissal raz
// ale loguje się następnego dnia powinien znowu widzieć banner.
// Loss aversion psychology: persistent reminder of perishable resource.
// Snooze (localStorage 24h) was replaced with per-session dismiss (sessionStorage)
// so the banner always returns when the user opens a new tab/window/login.

const SESSION_DISMISSED_KEY = STORAGE_KEYS.TRIAL_BANNER_DISMISSED;

function readSessionDismissed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return getSessionStorage(SESSION_DISMISSED_KEY) === '1';
}

function writeSessionDismissed(): void {
  if (typeof window === 'undefined') {
    return;
  }
  setSessionStorage(SESSION_DISMISSED_KEY, '1');
}

/* --- Helpers --- */

function formatExpiryTime(trialDate: Date, lang: string): string {
  // HH:MM w locale APLIKACJI, nie przeglądarki. Pusta lista locale ([]) oddaje
  // formatowanie ustawieniom przeglądarki, więc użytkowniczka z polskim UI na
  // angielskim systemie widziała w polskim zdaniu godzinę „11:30 PM".
  return trialDate.toLocaleTimeString(lang, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Re-evaluate the countdown this often while the banner can be visible, so a
 *  screen left open does not keep promising an expiry time that has passed. */
const COUNTDOWN_TICK_MS = TIME.MS_PER_MINUTE;

/* --- Public props --- */

export interface TrialCountdownBannerProps {
  /** ISO string, Date instance, or null (= no trial, render nothing). */
  trialEndsAt: Date | string | null;
  /** Called when the CTA button is clicked. */
  onClick?: () => void;
}

/* --- Component --- */

export function TrialCountdownBannerMolecule({
  trialEndsAt,
  onClick,
}: TrialCountdownBannerProps) {
  const t = useTranslations('trialCountdownBanner');
  const lang = useCurrentLang();
  // Per-session dismiss — initialised from sessionStorage synchronously.
  const [dismissed, setDismissed] = useState<boolean>(() =>
    readSessionDismissed()
  );

  const [now, setNow] = useState<number>(() => Date.now());

  // Widoczność liczona PRZED efektem, bo to ona bramkuje nasłuch klawiatury
  // (patrz DECISION niżej) — wczesne `return null` nie wystarczy.
  const countdown = resolveTrialCountdown(trialEndsAt, now);
  const isWithinWindow = countdown !== null;
  const isVisible = isWithinWindow && !dismissed;

  // Czas płynie także bez nawigacji: bez tego ekran otwarty przez noc dalej
  // obiecywał „kończy się dziś o 10:00" po 10:00 i nie znikał po końcu trialu.
  // Zegar chodzi dla KAŻDEGO trwającego trialu, nie tylko w oknie 7 dni: `now`
  // to stan z chwili montowania, więc aplikacja otwarta (lub wznowiona z tła)
  // przed wejściem w okno nigdy by do niego nie weszła i baner by nie wyskoczył.
  const hasTrial = trialEndsAt !== null;
  useEffect(() => {
    if (!hasTrial) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [hasTrial]);

  // DECISION (nie usuwaj tego komentarza):
  // Nasłuch Escape jest ZBRAMKOWANY widocznością bannera. Wcześniej efekt
  // rejestrował się bezwarunkowo, a wczesne `return null` wykonywało się dopiero
  // PO hookach — komponent jest montowany dla KAŻDEJ stylistki (AppLayout gate to
  // `role === 'stylist'`, nie „ma trial"). Skutek: dowolny Escape w aplikacji
  // (zamknięcie szuflady, dialogu, overlaya filtrów) zapisywał `dismissed` do
  // sessionStorage i wyciszał nudge trial→paid na całą sesję — także wtedy, gdy
  // banner nigdy się nie wyrenderował i użytkowniczka nie mogła go zobaczyć.
  // `defaultPrevented` zostawia pierwszeństwo warstwie, która obsłużyła Escape
  // wcześniej. Nie sięgamy tu po detekcję otwartego dialogu przez
  // `[aria-modal="true"]`: szuflada aplikacji jest kept-mounted (zamknięta nosi
  // dziś `inert` zamiast aria-modal, ale każdy przyszły kept-mounted overlay
  // wróciłby do tej pułapki), a portale Base UI i tak nie zawsze go stawiają.
  useEffect(() => {
    if (!isVisible) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        writeSessionDismissed();
        setDismissed(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isVisible]);

  if (!isVisible || countdown === null) {
    return null;
  }

  const { trialDate, daysRemaining, tier, titleKey } = countdown;
  const isLastDay = tier === 'lastDay';

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    writeSessionDismissed();
    setDismissed(true);
  }

  // Copy escalation (klucz liczy resolveTrialCountdown):
  // mild (4-7d): informational — "Trial kończy się za X dni."
  // urgent (1-3d): loss aversion — "Do końca trialu Pro: X dni."
  // lastDay (<24 h): "Trial wygasa dziś o HH:MM" albo "jutro o HH:MM".
  const titleParams: Record<string, string | number> =
    titleKey === 'titleLastHours' || titleKey === 'titleTomorrowAt'
      ? { time: formatExpiryTime(trialDate, lang) }
      : { days: daysRemaining };

  // a11y: role="alert" for last-day urgency (interrupts screen reader),
  // role="status" for earlier tiers (polite, non-interruptive).
  // DECISION (nie usuwaj tego komentarza): NIE dokładaj tu `aria-live`. Obie role
  // mają własną domyślną uprzejmość (alert = assertive, status = polite), a jawne
  // `aria-live='polite'` — które tu stało — nadpisywało assertive i degradowało
  // ostatni dzień do zwykłego komunikatu, czyli robiło odwrotność tego, co
  // obiecuje zdanie wyżej.
  const bannerRole: 'alert' | 'status' = isLastDay ? 'alert' : 'status';

  const bannerClass = [
    styles.banner,
    tier === 'mild' ? styles.mild : '',
    tier === 'urgent' ? styles.urgent : '',
    isLastDay ? styles.lastDay : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={bannerClass}
      role={bannerRole}
      aria-label={t('ariaLabel', { days: daysRemaining })}
      data-testid='trial-countdown-banner'>
      <div className={styles.inner}>
        <div className={styles.body}>
          <ClockAfternoonIcon
            size={20}
            className={styles.icon}
            aria-hidden='true'
          />
          <div className={styles.text}>
            <p className={styles.title}>{t(titleKey, titleParams)}</p>
            <p className={styles.subtitle} lang={lang}>
              {t('ctaSubtitle')}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <ButtonAtom
            direction='forward'
            variant='primary'
            size='sm'
            onClick={onClick}
            className={styles.cta}>
            {t('ctaUpgrade')}
          </ButtonAtom>
          <button
            type='button'
            className={styles.dismissBtn}
            onClick={handleDismiss}
            aria-label={t('dismissAriaLabel')}>
            <XIcon size={16} aria-hidden='true' />
          </button>
        </div>
      </div>
    </div>
  );
}
