// usePermanentCode — the stylist's permanent QR code and the three ways it
// leaves the screen (download, native share, copied link). Owned by the code
// screen (StylistPairingOrganism) and read by its one card.
//
// The QR encodes the URL of the PUBLIC PROFILE (identity, not access): a scan
// lands on the profile, the client sends a connection request from there and
// the gallery stays behind the stylist's acceptance. Safe to print.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import posthog from 'posthog-js';
import QRCode from 'qrcode';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { shareContent } from '../../../../application/platform/share';
import { copyText } from '../../../../application/platform/clipboard';
import { downloadPngDataUrl } from '../../../../application/platform/download';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useMaxScreenBrightness } from '../../../shared/hooks/useMaxScreenBrightness';

// URL profilu z originu okna (parytet DECISION w ProfileShareCard: poprawny
// na staging/preview/WebView; BRAND_CONFIG.url tylko jako SSR-fallback).
// ?from=qr TYLKO w URL-u kodowanym do QR — to licznik SKANÓW plakatu; link
// kopiowany/udostępniany (Messenger, SMS) idzie bez parametru, inaczej każde
// kliknięcie w link liczyłoby się jako skan i fałszowało lejek (review S51).
//
// DECISION (2026-07-12, po feedbacku ownera „czemu widzę ustaw adres zamiast
// kodu"): QR koduje ZAWSZE account_id — profil rozwiązuje OR(account_id,
// vanity_url), a account_id jest stabilny na zawsze, więc wydrukowany plakat
// przeżyje każdą zmianę vanity. Kod jest widoczny od PIERWSZEJ sekundy konta
// (zero gate'a na vanity). Vanity zostaje kanałem LINKU (ładny adres do
// wysyłania w wiadomości); nikt nie czyta URL-a zakodowanego w kratce QR.
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

// Składnik aktywacji (SSOT §8.3: „QR wydany") — po architekturze stałego
// kodu (2026-07-11) QR istnieje od pierwszej sekundy konta, więc mierzalnym
// sygnałem „wydania w świat" jest akcja dystrybucji: pobranie PNG, natywny
// share albo skopiowanie linku. Jeden event + channel (spina się z lejkiem
// stylist_profile_qr_scan → pair_request_*). Singleton respektuje opt-out.
function captureQrShared(channel: 'download' | 'share' | 'copy_link') {
  posthog.capture('stylist_qr_shared', { channel });
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
  // „Udostępnij" ma sens TYLKO tam, gdzie istnieje realny native-share sheet
  // (telefon / capable desktop). Bez niego shareContent spada do clipboardu =
  // dokładnie to samo, co przycisk „Kopiuj link" → redundancja, która myli
  // („nie wiem co ma robić"). Detekcja po mount (navigator w SSR nie istnieje →
  // brak hydration mismatch: SSR i pierwszy render dają false, potem doprecyzowanie).
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    );
  }, []);

  // Ekran z kodem JEST narzędziem: klientka celuje w niego aparatem, więc nie
  // może zgasnąć ani przygasnąć w połowie skanowania. Dzierżawa trwa tyle, ile
  // widok kodu (progressive enhancement — patrz screen-brightness.ts).
  useMaxScreenBrightness();
  // QR: stabilny account_id (wydruk wieczny). Link: vanity gdy jest (ładny).
  const codeUrl = accountId ? resolvePermanentCodeUrl(accountId, 'qr') : null;
  const shareUrl = accountId
    ? resolvePermanentCodeUrl(vanity ?? accountId, 'link')
    : null;

  useEffect(() => {
    if (!codeUrl) {
      return;
    }
    let cancelled = false;
    // Wyższa korekcja błędów niż kod sesyjny (M→Q): wydruk na papierze żyje
    // tygodniami przy stanowisku — zagięcia i odbicia światła są normą.
    void QRCode.toDataURL(codeUrl, {
      margin: 2,
      width: 220,
      errorCorrectionLevel: 'Q',
      color: { dark: '#1a1a1a', light: '#ffffff' },
    })
      .then(url => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        // QR jest wzbogaceniem — link do skopiowania zawsze działa.
      });
    return () => {
      cancelled = true;
    };
  }, [codeUrl]);

  // Pobranie idzie przez `downloadPngDataUrl`: w skorupie natywnej zapis robi
  // plugin Filesystem, bo `<a download>` na blob-URL-u jest w Android WebView
  // CICHYM NO-OP (patrz DECISION w download.ts) — przycisk wyglądał na udany,
  // a plik nie powstawał nigdy. Event dystrybucji leci wyłącznie po realnym
  // sukcesie (parytet z share/copy_link).
  const download = async () => {
    if (!qrDataUrl) {
      return;
    }
    const outcome = await downloadPngDataUrl({
      dataUrl: qrDataUrl,
      // Neutralna nazwa pliku (bez polskiego "kod") — ta sama dla EN/DE.
      filename: `nailfolio-${vanity ?? accountId ?? 'profil'}.png`,
    });
    if (outcome === false) {
      // Nigdy cicho: gdy zapis padł, user dostaje sygnał.
      pushNewSnackbar(t('permanentDownloadError'), 'error');
      return;
    }
    captureQrShared('download');
    if (outcome === 'native') {
      // W aplikacji nie ma paska pobierania przeglądarki, więc user musi
      // usłyszeć GDZIE plik wylądował, inaczej uzna, że nic się nie stało.
      pushNewSnackbar(t('permanentDownloadedToDocuments'), 'success');
    }
  };

  const copyLink = async () => {
    if (!shareUrl) {
      return;
    }
    // copyText: w skorupie natywnej schowek idzie przez mostek Capacitora, na
    // webie przez navigator.clipboard. Event dystrybucji dopiero po sukcesie.
    if (await copyText(shareUrl)) {
      captureQrShared('copy_link');
      pushNewSnackbar(t('permanentLinkCopied'), 'success');
    } else {
      pushNewSnackbar(t('permanentLinkCopyError'), 'error');
    }
  };

  // Natywny share (soczewka review: <a download> bywa no-op w WKWebView) —
  // link do profilu przez systemowy sheet dociera wszędzie; PNG zostaje jako
  // ścieżka desktopowa pod druk plakatu. Tekst = permanentShareText (adresowany
  // do ODBIORCY linku, nie instrukcja druku dla stylistki). Toast TYLKO gdy
  // realnie zadziałał cichy clipboard-fallback (desktop bez navigator.share) —
  // po natywnym/web sheecie system dał własny feedback (review S51).
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
    // outcome === false = anulowany sheet / błąd — nic nie wyszło w świat,
    // więc bez eventu (inaczej lejek liczyłby porzucone sheety jako wydania).
    if (outcome !== false) {
      captureQrShared('share');
    }
    if (outcome === 'clipboard') {
      pushNewSnackbar(t('permanentLinkCopied'), 'success');
    }
  };

  // Bez konta nie ma kodu. Błąd pierwszego pobrania to osobny stan z
  // ponowieniem: wcześniej wpadał w gałąź skeletonu i kręcił się bez końca.
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
