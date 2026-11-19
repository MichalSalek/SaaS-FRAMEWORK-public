// usePermanentCode — the stylist's permanent QR code and the three ways it
// leaves the screen (download, native share, copied link). Owned by the code
// screen and the salon profile manager, using the same code card.
//
// The QR encodes the URL of the PUBLIC PROFILE (identity, not access): a scan
// lands on the profile, the client sends a connection request from there and
// the gallery stays behind the stylist's acceptance. Safe to print.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { withLifecycleActionProperties } from '../../../../application/analytics/email-lifecycle';
import { capturePosthog } from '../../../../application/analytics/posthog-client';
import QRCode from 'qrcode';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { shareContent } from '../../../../application/platform/share';
import { copyText } from '../../../../application/platform/clipboard';
import { downloadPngDataUrl } from '../../../../application/platform/download';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';

// Profile URL from the window origin (parity with the DECISION in ProfileShareCard: correct
// on staging/preview/WebView; BRAND_CONFIG.url only as the SSR fallback).
// ?from=qr ONLY in the URL encoded into the QR: it counts poster SCANS; the
// copied/shared link (Messenger, SMS) goes without the parameter, otherwise every
// click on a link would count as a scan and skew the funnel.
//
// DECISION: the QR ALWAYS encodes account_id. The profile resolves OR(account_id, vanity_url) and
// account_id never changes, so a printed poster survives every vanity change, and the code exists
// from the account's first second (no vanity gate). Vanity is the LINK channel only.
// (owner)
function resolvePermanentCodeUrl(
  identifier: string,
  channel: 'qr' | 'link'
): string {
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : BRAND_CONFIG.url;
  const path = buildRoute(ROUTES_FRONT.STYLIST_PROFILE, { identifier });
  return channel === 'qr' ? `${origin}${path}?from=qr` : `${origin}${path}`;
}

// Activation component (the „QR issued” signal): the permanent code exists
// from the account's first second, so the measurable signal of „issued into the
// world” is a distribution action: PNG download, native share or copying the
// link. One event + channel (it joins the stylist_profile_qr_scan -> pair_request_*
// funnel). The singleton honours opt-out.
function captureQrShared(channel: 'download' | 'share' | 'copy_link') {
  withLifecycleActionProperties(attribution =>
    capturePosthog('stylist_qr_shared', { channel, ...attribution })
  );
}

export type PermanentCodeStatus = 'loading' | 'error' | 'ready';

export interface PermanentCode {
  status: PermanentCodeStatus;
  /** Empty until the QR is rendered; the frame keeps its box meanwhile. */
  qrDataUrl: string;
  /** A real native share sheet exists (phone / capable desktop). */
  canNativeShare: boolean;
  isRetrying: boolean;
  retry: () => void;
  download: () => Promise<void>;
  copyLink: () => Promise<void>;
  share: () => Promise<void>;
}

export function usePermanentCode(): PermanentCode {
  const t = useTranslations('pages.pairing');
  const {
    data: currentUser,
    isLoading: accountLoading,
    isError: accountError,
    isFetching: accountFetching,
    refetch: refetchAccount,
  } = useCurrentUserAccount();
  const accountId = currentUser?.stylist_account?.account_id ?? null;
  const vanity = currentUser?.stylist_account?.vanity_url ?? null;

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  // „Udostępnij” makes sense ONLY where a real native-share sheet exists
  // (phone / capable desktop). Without it shareContent falls back to the
  // clipboard = exactly what the „Kopiuj link” button does, a redundancy that
  // confuses. Detection after mount (navigator does not exist in SSR, so no
  // hydration mismatch: SSR and the first render give false, then it refines).
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    );
  }, []);

  // Brightness is NOT held here: this hook only prepares the code. The place
  // that SHOWS it raises the screen (DECISION in useMaxScreenBrightness.ts).
  // QR: the stable account_id (a print for good). Link: the vanity when set (prettier).
  const codeUrl = accountId ? resolvePermanentCodeUrl(accountId, 'qr') : null;
  const shareUrl = accountId
    ? resolvePermanentCodeUrl(vanity ?? accountId, 'link')
    : null;

  useEffect(() => {
    if (!codeUrl) {
      return;
    }
    let cancelled = false;
    // Higher error correction than the session code (M -> Q): a printout lives
    // for weeks at the stand, and creases and glare are the norm.
    void QRCode.toDataURL(codeUrl, {
      margin: 2,
      // Drawn 220 CSS px wide: three bitmap pixels per CSS pixel, so the code
      // stays crisp on a dense phone screen and on the printout.
      width: 660,
      errorCorrectionLevel: 'Q',
      color: { dark: '#1a1a1a', light: '#ffffff' },
    })
      .then(url => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        // The QR is an enrichment: the link to copy always works.
      });
    return () => {
      cancelled = true;
    };
  }, [codeUrl]);

  // The download goes through `downloadPngDataUrl`: in the native shell the
  // Filesystem plugin writes the file, because `<a download>` on a blob URL is a
  // SILENT NO-OP in the Android WebView (see the DECISION in download.ts). The
  // distribution event fires only after a real success (parity with share/copy_link).
  const download = async () => {
    if (!qrDataUrl) {
      return;
    }
    const outcome = await downloadPngDataUrl({
      dataUrl: qrDataUrl,
      // Neutral file name (without the Polish "kod"), the same for EN/DE.
      filename: `nailfolio-${vanity ?? accountId ?? 'profil'}.png`,
    });
    if (outcome === false) {
      // Never silent: when the save failed, the user gets a signal.
      pushNewSnackbar(t('permanentDownloadError'), 'error');
      return;
    }
    captureQrShared('download');
    if (outcome === 'native') {
      // The app has no browser download bar, so the user must hear WHERE the
      // file landed, or will think nothing happened.
      pushNewSnackbar(t('permanentDownloadedToDocuments'), 'success');
    }
  };

  const copyLink = async () => {
    if (!shareUrl) {
      return;
    }
    // copyText: in the native shell the clipboard goes through the Capacitor bridge,
    // on the web through navigator.clipboard. The distribution event only after success.
    if (await copyText(shareUrl)) {
      captureQrShared('copy_link');
      pushNewSnackbar(t('permanentLinkCopied'), 'success');
    } else {
      pushNewSnackbar(t('permanentLinkCopyError'), 'error');
    }
  };

  // Native share: the profile link through the system sheet reaches everywhere
  // (<a download> can be a no-op in WKWebView); the PNG stays as the desktop path
  // for printing the poster. Text = permanentShareText (addressed to the
  // RECIPIENT of the link, not a print instruction for the stylist). A toast ONLY
  // when the silent clipboard fallback actually worked (desktop without
  // navigator.share): after a native/web sheet the system gave its own feedback.
  const share = async () => {
    if (!shareUrl) {
      return;
    }
    // No `title`: the sheet used to be headed „Twój stały kod”, a label of
    // the stylist's own screen that the RECIPIENT of the link also read.
    const outcome = await shareContent({
      text: t('permanentShareText'),
      url: shareUrl,
    });
    // outcome === false = cancelled sheet / error: nothing went out into the
    // world, so no event (otherwise the funnel would count abandoned sheets as issued).
    if (outcome !== false) {
      captureQrShared('share');
    }
    if (outcome === 'clipboard') {
      pushNewSnackbar(t('permanentLinkCopied'), 'success');
    }
  };

  const status: PermanentCodeStatus =
    accountError && currentUser === undefined
      ? 'error'
      : accountLoading || accountId == null
        ? 'loading'
        : 'ready';

  return {
    status,
    qrDataUrl,
    canNativeShare,
    isRetrying: accountFetching,
    retry: () => void refetchAccount(),
    download,
    copyLink,
    share,
  };
}
