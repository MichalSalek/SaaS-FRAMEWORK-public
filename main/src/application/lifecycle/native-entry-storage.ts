import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { getFromClientStorage } from '../client-device-storage/clientStorage.possibilities.api';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import {
  getSessionStorage,
  setSessionStorage,
} from '../client-device-storage/session-storage-adapter/sessionStorage.adapter';

export type StoredNativeTokenRead = {
  available: boolean;
  token: string | null;
};

/** A storage exception is not evidence that there is no session to validate. */
export function readNativeEntryToken(): StoredNativeTokenRead {
  try {
    return {
      available: true,
      token:
        getFromClientStorage({ key: CUSTOM_HEADERS.authorization }) || null,
    };
  } catch {
    return { available: false, token: null };
  }
}

export function hasResolvedNativeEntry(): boolean {
  try {
    return getSessionStorage(STORAGE_KEYS.NATIVE_ENTRY_RESOLVED) !== null;
  } catch {
    return false;
  }
}

export function persistNativeEntryResolved(): void {
  try {
    setSessionStorage(STORAGE_KEYS.NATIVE_ENTRY_RESOLVED, '1');
  } catch {
    // The resolved route is still final for the currently mounted coordinator.
  }
}
