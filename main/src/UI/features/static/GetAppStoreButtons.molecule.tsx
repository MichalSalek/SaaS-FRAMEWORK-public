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
 * DECISION (nie usuwaj tego komentarza):
 * iOS is web-only at launch (no native iOS app — App Store IAP constraint,
 * owner decision; the product is reachable on iPhone through the mobile WEB).
 * So the App Store slot is ALWAYS a disabled "available in the future" tile
 * with ZERO routing — never an App Store link, never a deep link. Android is
 * the only native target: the Play button uses the config-driven STORE_URLS /
 * hasAnyStoreUrl
 * contract (empty -> a plain "coming soon" sentence, no button; filled via
 * NEXT_PUBLIC_STORE_URL_GOOGLE_PLAY -> live link, no code change to go live).
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
        /* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
           przed premierą w Google Play NIE ma tu przycisku. Wyłączony,
           wyblakły „Google Play” czytał się jak zepsuta kontrolka i niczego
           nie uczył (ta sama zasada co F1-02 na logowaniu: akcja jest żywa
           albo jej nie ma). Zostaje jedno zdanie ze znakiem sklepu; po
           ustawieniu NEXT_PUBLIC_STORE_URL_GOOGLE_PLAY wraca żywy przycisk. */
        <p className={styles.storeNote}>
          <span className={styles.noteIcon} aria-hidden='true'>
            <GooglePlayLogoIcon size={18} weight='regular' />
          </span>
          <span>{t('hero.comingSoon')}</span>
        </p>
      )}
      {/* iOS — plain informational line (apple glyph + text), NEVER a button.
          iOS is parked with no ETA, so it must NOT compete visually with the
          favoured Android CTA (owner 2026-07-18: the old tile rendered ~3× the
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
