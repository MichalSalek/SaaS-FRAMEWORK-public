import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import {
  getFromClientStorage,
  setToClientStorage,
} from '../../../application/client-device-storage/clientStorage.possibilities.api';

export const NATIVE_PUSH_STATE_EVENT = 'nf:native-push-state';

export interface NativePushState {
  optedOut: boolean;
  endpoint: string | null;
  registered: boolean;
}

type StateMap = Record<string, NativePushState>;

function states(): StateMap {
  const raw = getFromClientStorage({ key: STORAGE_KEYS.NATIVE_PUSH_STATE });
  if (!raw) {
    return Object.create(null) as StateMap;
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid native push state');
  }
  const result = Object.create(null) as StateMap;
  for (const [id, value] of Object.entries(parsed)) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('optedOut' in value) ||
      typeof value.optedOut !== 'boolean' ||
      !('registered' in value) ||
      typeof value.registered !== 'boolean' ||
      !('endpoint' in value) ||
      !(
        value.endpoint === null ||
        (typeof value.endpoint === 'string' && value.endpoint.length > 0)
      ) ||
      (value.registered === true && value.endpoint === null)
    ) {
      throw new Error('Invalid native push state');
    }
    result[id] = {
      optedOut: value.optedOut,
      endpoint: value.endpoint,
      registered: value.registered,
    };
  }
  return result;
}

export function readNativePushState(userId: string): NativePushState {
  return (
    states()[userId] ?? { optedOut: false, endpoint: null, registered: false }
  );
}

/** Fail closed if storage cannot retain the explicit device choice. */
export function writeNativePushState(
  userId: string,
  value: NativePushState
): void {
  const all = states();
  if (value.registered && value.endpoint !== null) {
    for (const [id, other] of Object.entries(all)) {
      if (id !== userId && other.endpoint === value.endpoint) {
        all[id] = { ...other, registered: false };
      }
    }
  }
  all[userId] = value;
  setToClientStorage({
    key: STORAGE_KEYS.NATIVE_PUSH_STATE,
    value: JSON.stringify(all),
  });
  const stored = readNativePushState(userId);
  if (
    stored.optedOut !== value.optedOut ||
    stored.endpoint !== value.endpoint ||
    stored.registered !== value.registered
  ) {
    throw new Error('Native push state could not be stored');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NATIVE_PUSH_STATE_EVENT));
  }
}
