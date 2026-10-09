// UI/features/auth/components/OnboardingStepWelcome.organism.tsx
//
// SPE-W4 — Step 1: the welcome / value-prop screen (warm opener).
//
// Sets a mentoring, low-pressure tone BEFORE asking for anything: three short
// value bullets ("what you'll have in a moment") + a risk-reduction reassurance
// ("30 days, the card only when you go paid"). This screen collects no data — the
// single "Continue" CTA advances to the role step.
//
// DECISION (nie usuwaj tego komentarza):
// The welcome step carries no required input. It used to offer a quiet
// "skip the intro" affordance, but it did the exact same thing as Continue
// (advance one step), so the duplicate was removed. The risk-reduction note is
// copy-only — the real trial mechanics live in the embedded checkout panel (W2)
// at the last step.

import { useTranslations } from 'next-intl';
import {
  HandshakeIcon,
  ImagesSquareIcon,
  PaletteIcon,
  QrCodeIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import type { OnboardingFormValues } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

interface OnboardingStepWelcomeProps {
  /** Active role. Passed from the page (not read via watch) so an effect-driven
   *  ?role= prefill re-renders this card — under react-compiler a memoized child
   *  reading watch('role') does not re-render on the prefill effect, leaving the
   *  hero (client copy) and this card (stylist copy) out of sync. Prop = SSOT. */
  role: OnboardingFormValues['role'];
}

export function OnboardingStepWelcomeOrganism({
  role,
}: OnboardingStepWelcomeProps) {
  const t = useTranslations('pages.onboarding');
  // Welcome is shown before the role step (role usually '') — stylist copy is
  // the default funnel. A client (prefilled ?role=client or an owned
  // ClientAccount, see roleHintFromAccounts) sees client-correct heading, value
  // props + a "no card, always free" reassurance instead of the stylist trial
  // note (a client never pays). Explicit literal keys per
  // branch keep next-intl's typed `t` sound (no dynamic key concatenation).
  const isClient = role === 'client';

  const bullets = isClient
    ? [
        {
          icon: <ImagesSquareIcon size={22} weight='duotone' />,
          title: t('welcomeBullet1TitleClient'),
          desc: t('welcomeBullet1DescClient'),
        },
        {
          icon: <QrCodeIcon size={22} weight='duotone' />,
          title: t('welcomeBullet2TitleClient'),
          desc: t('welcomeBullet2DescClient'),
        },
        {
          icon: <PaletteIcon size={22} weight='duotone' />,
          title: t('welcomeBullet3TitleClient'),
          desc: t('welcomeBullet3DescClient'),
        },
      ]
    : [
        {
          icon: <ImagesSquareIcon size={22} weight='duotone' />,
          title: t('welcomeBullet1Title'),
          desc: t('welcomeBullet1Desc'),
        },
        {
          icon: <QrCodeIcon size={22} weight='duotone' />,
          title: t('welcomeBullet2Title'),
          desc: t('welcomeBullet2Desc'),
        },
        {
          icon: <PaletteIcon size={22} weight='duotone' />,
          title: t('welcomeBullet3Title'),
          desc: t('welcomeBullet3Desc'),
        },
      ];

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepHeaderOrb} aria-hidden='true'>
            <HandshakeIcon size={26} weight='duotone' />
          </span>
          <TypographyAtom variant='h3' className={styles.stepTitle}>
            {isClient ? t('welcomeTitleClient') : t('welcomeTitle')}
          </TypographyAtom>
        </div>
        <p className={styles.stepSubtitle}>
          {isClient ? t('welcomeSubtitleClient') : t('welcomeSubtitle')}
        </p>
      </div>

      <ul className={styles.welcomeBullets}>
        {bullets.map(bullet => (
          <li key={bullet.title} className={styles.welcomeBullet}>
            <span className={styles.welcomeBulletIcon} aria-hidden='true'>
              {bullet.icon}
            </span>
            <span className={styles.welcomeBulletText}>
              <span className={styles.welcomeBulletTitle}>{bullet.title}</span>
              <span className={styles.welcomeBulletDesc}>{bullet.desc}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.welcomeReassure}>
        <span className={styles.welcomeReassureIcon} aria-hidden='true'>
          <ShieldCheckIcon size={20} weight='duotone' />
        </span>
        <span className={styles.welcomeReassureText}>
          <span className={styles.welcomeReassureTitle}>
            {isClient
              ? t('welcomeReassureTitleClient')
              : t('welcomeReassureTitle')}
          </span>
          <span className={styles.welcomeReassureDesc}>
            {isClient
              ? t('welcomeReassureDescClient')
              : t('welcomeReassureDesc')}
          </span>
        </span>
      </div>
    </>
  );
}
