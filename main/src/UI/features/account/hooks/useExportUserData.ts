// UI/features/account/hooks/useExportUserData.ts
// TQ v5 mutation — POST /api/v1/user/export-data (GDPR Art. 15 / 20).
// Dostarczenie payloadu jest platform-aware (patrz deliverExport). Backend
// rate-limituje 1 export / 24h. 401 handled by callHTTPEndpoint.
// Stack: TanStack Query v5.

import { useMutation } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { exportUserData_IO } from '../../../../domain/user/userIO.possibilities.api';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

/* ─── Types ─── */

type ExportRequest = USER_DTO_API_V1['USER_EXPORT_DATA']['REQUEST'];
type ExportResponse = USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE'];

/**
 * Jak payload faktycznie dotarł do usera — komponent dobiera toast.
 * 'clipboard-failed' = eksport się POWIÓDŁ (rate-limit naliczony backendem),
 * ale WebView odmówił zapisu do schowka — toast musi to uczciwie powiedzieć
 * zamiast udawać błąd eksportu (review S50b F6).
 */
export type ExportDelivery = 'download' | 'clipboard' | 'clipboard-failed';

export interface ExportResult {
  delivery: ExportDelivery;
  filename: string;
}

/* ─── Filename helper ─── */

function buildFilename(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `moje-dane-nailfolio-${today}.json`;
}

/* ─── Delivery (platform-aware) ─── */

// DECISION (nie usuwaj tego komentarza):
// Android WebView (Capacitor wrapper) NIE ma DownloadListenera — kliknięcie
// <a download> z blob: URL jest PO CICHU ignorowane (zero błędu, zero pliku),
// a toast „wyeksportowano" kłamał (owner 2026-07-11). Do czasu dodania
// DownloadListenera we wrapperze (rebuild APK, user-only) natywna ścieżka
// dostarcza JSON przez schowek — uczciwie komunikowane osobnym toastem.
// Web: zwykły blob-download; revokeObjectURL odroczony (Safari potrafi
// anulować pobieranie przy synchronicznym revoke).
async function deliverExport(
  payload: ExportResponse,
  filename: string
): Promise<ExportDelivery> {
  const json = JSON.stringify(payload, null, 2);

  if (Capacitor.isNativePlatform()) {
    // Async Clipboard API po długim awaicie sieci może stracić transient user
    // activation (Android WebView → NotAllowedError; review S50b #2). Wrapper
    // NIE implementuje pluginów natywnych (@capacitor/clipboard odpada —
    // patrz DEEPLINK_LOGIN.md), więc fallback = legacy execCommand('copy')
    // (synchroniczny, w WebView nie podlega async-permission-model). Dopiero
    // gdy oba zawiodą → 'clipboard-failed' (uczciwy warning-toast; slot 1/24h
    // już naliczony backendem, to NIE jest błąd eksportu).
    try {
      await navigator.clipboard.writeText(json);
      return 'clipboard';
    } catch {
      // Textarea z CAŁYM eksportem danych nie może zostać w DOM, gdy select()/
      // execCommand rzuci — stąd finally (każda kolejna próba dokładałaby ukryty
      // element z pełnym payloadem).
      const ta = document.createElement('textarea');
      try {
        ta.value = json;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        return ok ? 'clipboard' : 'clipboard-failed';
      } catch {
        return 'clipboard-failed';
      } finally {
        ta.remove();
      }
    }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'download';
}

/* ─── Hook ─── */

/**
 * GDPR data export mutation. Backend enforces 1-per-24h rate limit; on rate-limit
 * the error envelope carries `USER_DATA_EXPORT_RATE_LIMITED`. UI shows snackbar.
 * Payload nie jest persystowany server-side; dostarczenie = deliverExport
 * (web: download pliku, native: schowek). Wynik mówi komponentowi, KTÓRĄ
 * ścieżką dane dotarły — toast musi mówić prawdę o miejscu docelowym.
 */
export function useExportUserData() {
  return useMutation<ExportResult, Error, ExportRequest>({
    mutationFn: async req => {
      const payload = await exportUserData_IO(req);
      // Jedna nazwa na przebieg: toast cytuje DOKŁADNIE nazwę pobranego pliku
      // (dwa wywołania tuż przed i po północy UTC dawały dwie różne daty).
      const filename = buildFilename();
      const delivery = await deliverExport(payload, filename);
      return { delivery, filename };
    },
    meta: { suppressGlobalError: true },
  });
}
