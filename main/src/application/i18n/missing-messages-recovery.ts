import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import {
  getSessionStorage,
  setSessionStorage,
} from '../client-device-storage/session-storage-adapter/sessionStorage.adapter';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';

/** A second miss on the same URL within this window means the reload did not help. */
export const MISSING_MESSAGES_RELOAD_TTL_MS = 60_000;

type ReloadMarker = { url: string; at: number };

const readMarker = (): ReloadMarker | null => {
  try {
    const raw = getSessionStorage(STORAGE_KEYS.I18N_MISSING_MESSAGES_RELOAD);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'url' in parsed &&
      'at' in parsed &&
      typeof parsed.url === 'string' &&
      typeof parsed.at === 'number'
    ) {
      return { url: parsed.url, at: parsed.at };
    }
    return null;
  } catch {
    return null;
  }
};

const writeMarker = (marker: ReloadMarker): boolean => {
  try {
    setSessionStorage(
      STORAGE_KEYS.I18N_MISSING_MESSAGES_RELOAD,
      JSON.stringify(marker)
    );
    return readMarker()?.at === marker.at;
  } catch {
    return false;
  }
};

export type MissingMessagesOutcome = 'reloaded' | 'suppressed';

/**
 * A client render whose page props arrived without `messages` (a cached
 * prefetch `{}` served for the real navigation, a truncated data response).
 *
 * DECISION: recover with ONE full document load of the same URL, loop-guarded by a sessionStorage
 * marker (URL + time). The document request carries the messages in `__NEXT_DATA__` and bypasses the
 * `/_next/data` response that lost them; without the reload she reads a page of empty labels. A
 * second miss on the same URL inside the TTL, or storage we cannot write, means a reload would loop,
 * so the page stays as it is and the report says so. Both outcomes are reported: the edge cache rule
 * that caused it once is guarded at deploy (`scripts/deploy/_ssr-data-cache-gate.sh`), and this is
 * the alarm when something else does it.
 */
export function recoverFromMissingMessages({
  url,
  route,
  now = Date.now(),
  reload = () => window.location.reload(),
}: {
  url: string;
  route: string;
  now?: number;
  reload?: () => void;
}): MissingMessagesOutcome {
  const marker = readMarker();
  const recentlyReloaded =
    marker !== null &&
    marker.url === url &&
    now - marker.at < MISSING_MESSAGES_RELOAD_TTL_MS;
  if (recentlyReloaded || !writeMarker({ url, at: now })) {
    reportIssueFrontend({
      namespace: 'I18N',
      message: 'Page rendered without messages; reload suppressed',
      payload: { url, route, recentlyReloaded },
      mode: 'error',
    });
    return 'suppressed';
  }
  reportIssueFrontend({
    namespace: 'I18N',
    message: 'Page rendered without messages; reloading the document',
    payload: { url, route },
    mode: 'error',
  });
  reload();
  return 'reloaded';
}
