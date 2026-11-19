import { useMutation } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { exportUserData_IO } from '../../../../domain/user/userIO.possibilities.api';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

/* ─── Types ─── */

type ExportRequest = USER_DTO_API_V1['USER_EXPORT_DATA']['REQUEST'];
type ExportResponse = USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE'];

/**
 * How the payload actually reached the user: the component picks the toast.
 * 'clipboard-failed' = the export SUCCEEDED (rate limit already counted by the backend) but
 * WebView refused the clipboard write; the toast must say so instead of faking an export error.
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

// DECISION: Android WebView (the Capacitor wrapper) has no DownloadListener: a click on <a
// download> with a blob: URL is SILENTLY ignored (no error, no file), and the "exported" toast lied
// (owner). Until the wrapper gets a DownloadListener (APK rebuild, user-only), the
// native path delivers the JSON through the clipboard, honestly communicated by a separate toast.
// Web: a plain blob download; revokeObjectURL is deferred (Safari can cancel the download on a
// synchronous revoke).
async function deliverExport(
  payload: ExportResponse,
  filename: string
): Promise<ExportDelivery> {
  const json = JSON.stringify(payload, null, 2);

  if (Capacitor.isNativePlatform()) {
    // The async Clipboard API can lose transient user activation after a long network await
    // (Android WebView → NotAllowedError). The wrapper has NO native plugins (@capacitor/clipboard is
    // out, see DEEPLINK_LOGIN.md), so the fallback is legacy execCommand('copy') (synchronous, not
    // subject to the async permission model in WebView). Only when both fail → 'clipboard-failed'
    // (an honest warning toast; the 1/24h slot is already used by the backend, this is NOT an export
    // error).
    try {
      await navigator.clipboard.writeText(json);
      return 'clipboard';
    } catch {
      // A textarea holding the WHOLE data export must not stay in the DOM when select()/execCommand
      // throws, hence finally (each later attempt would add a hidden element with the full payload).
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

export function useExportUserData() {
  return useMutation<ExportResult, Error, ExportRequest>({
    mutationFn: async req => {
      // One success owner: the completion line under the button states where
      // the data went (a clipboard failure included); the event toast said
      // „exported” even when the clipboard refused (successFeedback, io.ts).
      const payload = await exportUserData_IO(req, {
        successFeedback: 'screen',
      });
      // One name per run: the toast quotes EXACTLY the downloaded file name (two calls just before and
      // after midnight UTC gave two different dates).
      const filename = buildFilename();
      const delivery = await deliverExport(payload, filename);
      return { delivery, filename };
    },
    meta: { suppressGlobalError: true },
    onError: error => {
      trackFlowStep('account', 'failed', {
        action: 'export',
        code: flowErrorCode(error),
      });
    },
    onSuccess: ({ delivery }) => {
      trackFlowStep('account', 'data_exported', { delivery });
    },
  });
}
