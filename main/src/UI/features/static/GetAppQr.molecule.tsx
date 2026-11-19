import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import styles from './GetAppQr.module.css';

/** From this width the page is read on a computer, not on a phone. */
const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * GetAppQr — the way from a computer to the phone: a code that opens Nailfolio
 * in the phone's browser.
 *
 * DECISION: on a computer the QR code is the only way from this page to the phone
 * (it opens sign-up in the page locale).
 *  - Only from 1024px: on a phone the reader is already where the code leads, so it
 *    is neither drawn nor computed.
 *  - `qrcode` is imported dynamically when the code is shown, so phones pay nothing.
 *  - The URL carries `utm_source=get-app&utm_medium=qr` to separate scan sign-ups.
 *  - The code is always dark on white, also in dark mode, so every camera reads it.
 */
export function GetAppQrMolecule() {
  const t = useTranslations('static.getApp');
  const { locale, defaultLocale } = useRouter();
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      return;
    }
    let cancelled = false;
    const prefix =
      locale !== undefined && locale !== defaultLocale ? `/${locale}` : '';
    const target = `${window.location.origin}${prefix}${ROUTES_FRONT.USER_LOG}/?intent=register&utm_source=get-app&utm_medium=qr`;
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(target, {
          margin: 2,
          // Drawn at up to 264 CSS px: three bitmap pixels per CSS pixel.
          width: 792,
          errorCorrectionLevel: 'M',
          color: { dark: '#1a1a1a', light: '#ffffff' },
        })
      )
      .then(url => {
        if (!cancelled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        // The code is a shortcut; the address in the browser bar still works.
      });
    return () => {
      cancelled = true;
    };
  }, [locale, defaultLocale]);

  if (dataUrl === '') {
    return null;
  }

  return (
    <div className={styles.qr}>
      <img
        src={dataUrl}
        alt={t('hero.qrAlt')}
        className={styles.code}
        width={132}
        height={132}
      />
      <p className={styles.note}>{t('hero.qrNote')}</p>
    </div>
  );
}
