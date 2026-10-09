// UI/features/shared/profile/ProfileShareCard.organism.tsx
// Profile Hub: surfaces the stylist's own public profile link so she can share
// it (IG bio, clients) and close the organic discovery / viral loop.
// Współdzielona (features/shared/**) od 2026-09-09: montują ją dashboard
// stylistki I ekran zarządzania profilem publicznym (/app/profile). Stąd też
// namespace `components.profileShare` zamiast dawnego `dashboard.stylist.*` —
// `components` jest w CORE_NAMESPACES, więc karta nie wymaga doładowania
// przestrzeni na każdej stronie, która ją montuje.
// GROWTH-CRITICAL (audit APP-CORE 1C): app previously had no in-product way for
// a stylist to share her own /stylist/{vanity} profile.
// Stack: TQ v5 (useCurrentUserAccount) + CSS Modules + Phosphor Icons.

import { Fragment, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import {
  CardMolecule,
  CardContentAtom,
} from '../../../components/Card/Card.molecule';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { shareContent } from '../../../../application/platform/share';
import { copyText } from '../../../../application/platform/clipboard';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import styles from './ProfileShareCard.module.css';

/* --- Helpers --- */

// DECISION (nie usuwaj tego komentarza):
// The shareable URL is built from window.location.origin (client-only) rather
// than the brand origin — this keeps share/copy links correct across
// staging, preview and native WebView origins. BRAND_CONFIG.url is only the
// SSR/no-window fallback (canonical production origin). The display label strips
// the scheme for a cleaner read; the copied/shared value is always the full URL.
function resolveProfileUrl(vanity: string): string {
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : BRAND_CONFIG.url;
  const path = buildRoute(ROUTES_FRONT.STYLIST_PROFILE, { identifier: vanity });
  return `${origin}${path}`;
}

function toDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/* --- Empty state: vanity not set yet ---
 * CTA prowadzi do /app/profile (od 2026-09-09), gdzie mieszka pole adresu —
 * wcześniej wysyłało na goły ekran konta, na którym trzeba było jeszcze
 * znaleźć właściwą sekcję. */

function ProfileShareEmpty({
  ctaVariant,
}: {
  ctaVariant: 'primary' | 'outlined';
}) {
  const t = useTranslations('components.profileShare');
  const lang = useCurrentLang();

  return (
    <CardMolecule variant='outlined' className={styles.card}>
      <CardContentAtom className={styles.content}>
        <TypographyAtom variant='h4' as='h2' className={styles.title}>
          {t('emptyTitle')}
        </TypographyAtom>
        <TypographyAtom variant='body2' className={styles.body} lang={lang}>
          {t('emptyBody')}
        </TypographyAtom>
        <div className={styles.actions}>
          <LinkButtonAtom
            href={ROUTES_FRONT.STYLIST_PROFILE_MANAGE}
            variant={ctaVariant}
            size='sm'
            direction='forward'
            className={styles.action}>
            {t('emptyCta')}
          </LinkButtonAtom>
        </div>
      </CardContentAtom>
    </CardMolecule>
  );
}

/* --- Active state: vanity present --- */

/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
 * The address is never cut: it wraps (`overflow-wrap: anywhere`) next to a
 * real „Kopiuj” button. It used to be a one-line chip with an ellipsis and a
 * 16px copy glyph, so she could not read what she was about to send.
 * „Skopiowano” is shown IN the button and moves nothing: both labels and both
 * glyphs occupy one grid cell, the idle one is hidden, so the button keeps the
 * width of the longer label in every language. No success toast on top of it
 * (one fact, one place); a failed copy still toasts, since nothing on the card
 * would say so. */
function ProfileShareActive({
  vanity,
  ctaVariant,
}: {
  vanity: string;
  ctaVariant: 'primary' | 'outlined';
}) {
  const t = useTranslations('components.profileShare');
  const lang = useCurrentLang();
  const [copied, setCopied] = useState(false);

  const profileUrl = resolveProfileUrl(vanity);
  const displayUrl = toDisplayUrl(profileUrl);

  // Timer gaszący feedback z cleanupem (unmount w trakcie 2s = setState na
  // odmontowanym komponencie) — wzorzec jak w StylistProfilePage.composition.
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    // copyText: w skorupie natywnej schowek idzie przez mostek, na webie przez
    // navigator.clipboard — helper nigdy nie rzuca, zwraca sam wynik.
    if (await copyText(profileUrl)) {
      setCopied(true);
    } else {
      pushNewSnackbar(t('copyError'), 'error');
    }
  };

  const handleShare = async () => {
    await shareContent({
      title: t('shareTitle'),
      text: t('shareText'),
      url: profileUrl,
    });
  };

  return (
    <CardMolecule variant='outlined' className={styles.card}>
      <CardContentAtom className={styles.content}>
        <TypographyAtom variant='h4' as='h2' className={styles.title}>
          {t('title')}
        </TypographyAtom>
        <TypographyAtom variant='body2' className={styles.body} lang={lang}>
          {t('body')}
        </TypographyAtom>

        <div className={styles.address}>
          <span className={styles.url}>
            {/* A break is offered after every slash, so the address wraps
                between its parts („…/stylist/” | „velvet-nails”), not in the
                middle of a word. */}
            {displayUrl.split('/').map((part, index, parts) => (
              <Fragment key={`${String(index)}-${part}`}>
                {part}
                {index < parts.length - 1 && (
                  <>
                    /<wbr />
                  </>
                )}
              </Fragment>
            ))}
          </span>
          <ButtonAtom
            variant='outlined'
            size='sm'
            className={styles.copy}
            icon={
              <span className={styles.swap}>
                <CopyIcon data-shown={copied ? undefined : ''} />
                <CheckIcon weight='bold' data-shown={copied ? '' : undefined} />
              </span>
            }
            onClick={() => void handleCopy()}>
            <span
              className={`${styles.swap} ${styles.swapLabel}`}
              aria-live='polite'>
              <span
                data-shown={copied ? undefined : ''}
                aria-hidden={copied ? 'true' : undefined}>
                {t('copyAction')}
              </span>
              <span
                data-shown={copied ? '' : undefined}
                aria-hidden={copied ? undefined : 'true'}>
                {t('copiedLabel')}
              </span>
            </span>
          </ButtonAtom>
        </div>

        <div className={styles.actions}>
          <ButtonAtom
            variant={ctaVariant}
            size='sm'
            className={styles.action}
            onClick={() => void handleShare()}>
            {t('shareAction')}
          </ButtonAtom>
          <LinkButtonAtom
            href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
              identifier: vanity,
            })}
            variant='outlined'
            size='sm'
            className={styles.action}>
            {t('previewAction')}
          </LinkButtonAtom>
        </div>
      </CardContentAtom>
    </CardMolecule>
  );
}

/* --- Public component --- */

export function ProfileShareCardOrganism({
  ctaVariant = 'primary',
}: {
  /** Dashboard passes outlined when another filled CTA already owns the screen. */
  ctaVariant?: 'primary' | 'outlined';
}) {
  const { data: currentUser } = useCurrentUserAccount();
  const vanity = currentUser?.stylist_account?.vanity_url ?? null;

  if (!vanity) {
    return <ProfileShareEmpty ctaVariant={ctaVariant} />;
  }
  return <ProfileShareActive vanity={vanity} ctaVariant={ctaVariant} />;
}
