import {
  getSessionStorage,
  setSessionStorage,
} from '../client-device-storage/session-storage-adapter/sessionStorage.adapter';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import { isLeaveGuardArmed } from '../routing/leave-guard';
import { getDocumentBuildId } from './document-build';

export type ChunkRecoveryOutcome = 'unrelated' | 'reloaded' | 'suppressed';

export function isOwnChunkLoadFailure(
  message: string,
  origin: string
): boolean {
  if (!/Loading (?:CSS )?chunk [\w-]+ failed\./.test(message)) {
    return false;
  }
  const matched = message.match(/(?:https?:\/\/|\/_next\/static\/)[^\s)]+/);
  if (!matched) {
    return false;
  }
  try {
    const url = new URL(matched[0], origin);
    return (
      url.origin === origin &&
      url.pathname.startsWith('/_next/static/') &&
      /\.(?:js|css)$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

// DECISION: an older open tab may request a chunk from a retired release. Reload at most once
// per build in this tab, only with writable session storage and no registered unsaved work.
// A repeated failure stays visible to the error sink. Test: chunk-load-recovery.test.ts
// (covers one retry, storage failures and armed leave guards; not browser cache behavior).
export function recoverFromChunkLoadFailure({
  message,
  buildId = getDocumentBuildId(),
  origin = window.location.origin,
  online = navigator.onLine,
  hasUnsavedWork = isLeaveGuardArmed(),
  reload = () => window.location.reload(),
}: {
  message: string;
  buildId?: string | null;
  origin?: string;
  online?: boolean;
  hasUnsavedWork?: boolean;
  reload?: () => void;
}): ChunkRecoveryOutcome {
  if (!isOwnChunkLoadFailure(message, origin)) {
    return 'unrelated';
  }
  if (!buildId || !online || hasUnsavedWork) {
    return 'suppressed';
  }
  try {
    if (getSessionStorage(STORAGE_KEYS.CHUNK_RECOVERY_BUILD) === buildId) {
      return 'suppressed';
    }
    setSessionStorage(STORAGE_KEYS.CHUNK_RECOVERY_BUILD, buildId);
    if (getSessionStorage(STORAGE_KEYS.CHUNK_RECOVERY_BUILD) !== buildId) {
      return 'suppressed';
    }
  } catch {
    return 'suppressed';
  }
  reload();
  return 'reloaded';
}
