import { AppleLogoIcon, GooglePlayLogoIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import {
  getStoreUrl,
  hasAnyStoreUrl,
} from '@kernel/domain/platform/platform.config';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import styles from './GetAppStoreButtons.module.css';

/**
 * Hero store buttons for /get-app — config-driven via STORE_URLS.
 *
 * DECISION: iOS is web-only at launch (no native iOS app), so the App Store slot is
 * always a plain informational line with zero routing: never an App Store link or a
 * deep link. Android is the only native target: an empty
 * NEXT_PUBLIC_STORE_URL_GOOGLE_PLAY renders a "coming soon" sentence, a set one
 * renders the live Play button with no code change. (owner)
 */
export function GetAppStoreButtonsMolecule() {
  const t = useTranslations('static.getApp');

  const androidUrl = getStoreUrl('android');
  const androidLive = hasAnyStoreUrl() && androidUrl !== '';

  return (
    <>
      {androidLive ? (
        <div className={styles.storeButtons}>
          <LinkButtonAtom
            href={androidUrl}
            external
            variant='primary'
            size='lg'
            ariaLabel={t('hero.googlePlayAriaLabelActive')}>
            {t('hero.googlePlayLabel')}
          </LinkButtonAtom>
        </div>
      ) : (
        /* DECISION: before the Google Play launch there is no button here: a
           disabled, faded "Google Play" read as a broken control. One sentence
           with the store mark stays; setting NEXT_PUBLIC_STORE_URL_GOOGLE_PLAY
           brings the live button back. (owner) */
        <p className={styles.storeNote}>
          <span className={styles.noteIcon} aria-hidden='true'>
            <GooglePlayLogoIcon size={18} weight='regular' />
          </span>
          <span>{t('hero.comingSoon')}</span>
        </p>
      )}
      {/* iOS — plain informational line (apple glyph + text), NEVER a button.
          iOS is parked with no ETA, so it must NOT compete visually with the
          favoured Android CTA (owner: the old tile rendered ~3× the
          Play button and read as an equal action). ZERO routing (see DECISION). */}
      <p className={styles.storeNote}>
        <span className={styles.noteIcon} aria-hidden='true'>
          <AppleLogoIcon size={18} weight='regular' />
        </span>
        <span>{t('hero.appStoreLabel')}</span>
      </p>
    </>
  );
}
