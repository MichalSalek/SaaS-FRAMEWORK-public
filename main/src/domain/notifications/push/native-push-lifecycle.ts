import {
  registerPushSubscription_IO,
  unregisterPushSubscription_IO,
} from '../notificationsIO.possibilities.api';
import { authClient } from '../../../application/auth/better-auth-client';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { getFromClientStorage } from '../../../application/client-device-storage/clientStorage.possibilities.api';
import { reportIssueFrontend } from '../../../application/error-debugger/errorHandler.possibilities.api';
import { readNativePushState, writeNativePushState } from './native-push-state';
import { getPlugin } from './native-push';
import { obtainToken } from './native-push-token';

export type NativeSubscribeOutcome = 'subscribed' | 'denied' | 'failed';

type NativePushIdentity = {
  userId: string;
  authorization: string;
  becomeUser: string | null;
};
let generation = 0;
let choiceVersion = 0;
let deviceQueue: Promise<void> = Promise.resolve();

function reportNativePushFailure(action: 'register' | 'remove'): void {
  reportIssueFrontend({
    namespace: 'NATIVE_PUSH_REGISTRATION',
    message: `Native push ${action} failed`,
    payload: null,
    mode: 'warn',
  });
}

/** Invalidate in-flight callbacks before sign-out changes or clears the bearer. */
export function invalidateNativePushWork(): void {
  generation += 1;
}

function queueDeviceWork<T>(work: () => Promise<T>): Promise<T> {
  const result = deviceQueue.then(work, work);
  deviceQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function sameIdentity(identity: NativePushIdentity, epoch: number): boolean {
  return (
    generation === epoch &&
    getFromClientStorage({ key: CUSTOM_HEADERS.authorization }) ===
      identity.authorization &&
    getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser }) ===
      identity.becomeUser
  );
}

/** The server identifies the captured bearer; cached account data cannot identify a newer token. */
async function resolveIdentity(): Promise<NativePushIdentity | null> {
  try {
    const authorization = getFromClientStorage({
      key: CUSTOM_HEADERS.authorization,
    });
    const becomeUser = getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
    if (!authorization || becomeUser) {
      return null;
    }
    const epoch = generation;
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization;
    const result = await authClient.getSession({
      fetchOptions: { auth: { type: 'Bearer', token } },
    });
    const userId = result.data?.user?.id;
    const identity = { userId: userId ?? '', authorization, becomeUser };
    return !result.error && userId && sameIdentity(identity, epoch)
      ? identity
      : null;
  } catch {
    return null;
  }
}

async function registerForIdentity(
  identity: NativePushIdentity,
  epoch: number,
  explicit: boolean,
  choiceAtStart: number
): Promise<boolean> {
  const handle = await getPlugin();
  if (!handle || !sameIdentity(identity, epoch)) {
    return false;
  }
  const token = await obtainToken(handle.plugin);
  if (!sameIdentity(identity, epoch) || choiceVersion !== choiceAtStart) {
    return false;
  }
  const previous = readNativePushState(identity.userId);
  if (previous.optedOut && !explicit) {
    return false;
  }
  if (previous.endpoint && previous.endpoint !== token) {
    await unregisterPushSubscription_IO(
      { endpoint: previous.endpoint },
      { silentBusinessError: true }
    );
    if (!sameIdentity(identity, epoch) || choiceVersion !== choiceAtStart) {
      return false;
    }
  }
  // Save the endpoint before the write: a lost acknowledgement can still be undone on opt-out.
  writeNativePushState(identity.userId, {
    ...previous,
    endpoint: token,
    registered: false,
  });
  if (!sameIdentity(identity, epoch)) {
    return false;
  }
  const result = await registerPushSubscription_IO(
    { platform: 'FCM', endpoint: token },
    { silentBusinessError: true }
  );
  if (
    !result.subscription_id ||
    !sameIdentity(identity, epoch) ||
    choiceVersion !== choiceAtStart
  ) {
    return false;
  }
  const current = readNativePushState(identity.userId);
  if (current.optedOut && !explicit) {
    return false;
  }
  writeNativePushState(identity.userId, {
    optedOut: false,
    endpoint: token,
    registered: true,
  });
  return true;
}

/** Refresh only a granted, opted-in device. No permission prompt on startup. */
export async function syncNativePush(): Promise<void> {
  const epoch = generation;
  const choiceAtStart = choiceVersion;
  const identity = await resolveIdentity();
  if (!identity || !sameIdentity(identity, epoch)) {
    return;
  }
  let action: 'register' | 'remove' = 'register';
  await queueDeviceWork(async () => {
    if (!sameIdentity(identity, epoch) || choiceVersion !== choiceAtStart) {
      return;
    }
    const state = readNativePushState(identity.userId);
    if (state.optedOut) {
      action = 'remove';
      if (state.endpoint) {
        await unregisterForIdentity(identity, epoch, state.endpoint, true);
      }
      return;
    }
    const handle = await getPlugin();
    if (
      handle &&
      (await handle.plugin.checkPermissions()).receive === 'granted' &&
      sameIdentity(identity, epoch)
    ) {
      await registerForIdentity(identity, epoch, false, choiceAtStart);
    }
  }).catch(() => reportNativePushFailure(action));
}

/** The UI reports on only after this identity has a backend acknowledgement. */
export async function getNativePushRegistrationState(): Promise<{
  subscribed: boolean;
  removalPending: boolean;
}> {
  const epoch = generation;
  const identity = await resolveIdentity();
  // Registration writes an unconfirmed endpoint before the backend responds.
  // Do not expose that intermediate state as an explicit opt-out to the UI.
  await deviceQueue;
  if (!identity || !sameIdentity(identity, epoch)) {
    throw new Error(
      'Native push identity unavailable or changed during state read'
    );
  }
  const state = readNativePushState(identity.userId);
  return {
    subscribed: !state.optedOut && state.registered,
    removalPending: state.optedOut && state.endpoint !== null,
  };
}

export async function subscribeNativePush(): Promise<NativeSubscribeOutcome> {
  const epoch = generation;
  const choiceAtStart = ++choiceVersion;
  const identity = await resolveIdentity();
  if (!identity) {
    return 'failed';
  }
  try {
    return await queueDeviceWork(async () => {
      const handle = await getPlugin();
      if (
        !handle ||
        !sameIdentity(identity, epoch) ||
        choiceVersion !== choiceAtStart
      ) {
        return 'failed';
      }
      const permission = await handle.plugin.requestPermissions();
      if (!sameIdentity(identity, epoch) || choiceVersion !== choiceAtStart) {
        return 'failed';
      }
      if (permission.receive !== 'granted') {
        return 'denied';
      }
      return (await registerForIdentity(identity, epoch, true, choiceAtStart))
        ? 'subscribed'
        : 'failed';
    });
  } catch {
    reportNativePushFailure('register');
    return 'failed';
  }
}

async function unregisterForIdentity(
  identity: NativePushIdentity,
  epoch: number,
  endpoint: string,
  optedOut: boolean
): Promise<boolean> {
  if (!sameIdentity(identity, epoch)) {
    return false;
  }
  await unregisterPushSubscription_IO(
    { endpoint },
    { silentBusinessError: true }
  );
  if (!sameIdentity(identity, epoch)) {
    return false;
  }
  writeNativePushState(identity.userId, {
    optedOut,
    endpoint: null,
    registered: false,
  });
  return true;
}

/** Preserve explicit opt-out even if backend removal needs a later retry. */
export async function unsubscribeNativePush(): Promise<boolean> {
  const epoch = generation;
  const choiceAtStart = ++choiceVersion;
  const identity = await resolveIdentity();
  if (!identity || choiceVersion !== choiceAtStart) {
    return false;
  }
  try {
    const current = readNativePushState(identity.userId);
    writeNativePushState(identity.userId, { ...current, optedOut: true });
    return await queueDeviceWork(async () => {
      if (!sameIdentity(identity, epoch) || choiceVersion !== choiceAtStart) {
        return false;
      }
      const handle = await getPlugin();
      const state = readNativePushState(identity.userId);
      const endpoint =
        state.endpoint ?? (handle ? await obtainToken(handle.plugin) : null);
      if (
        !endpoint ||
        !sameIdentity(identity, epoch) ||
        choiceVersion !== choiceAtStart
      ) {
        return false;
      }
      writeNativePushState(identity.userId, {
        ...state,
        optedOut: true,
        endpoint,
      });
      if (!(await unregisterForIdentity(identity, epoch, endpoint, true))) {
        return false;
      }
      try {
        await handle?.plugin.unregister();
      } catch {
        /* backend is already clear */
      }
      return true;
    });
  } catch {
    reportNativePushFailure('remove');
    return false;
  }
}

/** Best effort before logout; unlike switch-off this keeps the user's preference. */
export async function forgetNativePushDevice(): Promise<void> {
  invalidateNativePushWork();
  const epoch = generation;
  const identity = await resolveIdentity();
  if (!identity) {
    return;
  }
  await queueDeviceWork(async () => {
    if (!sameIdentity(identity, epoch)) {
      return;
    }
    const state = readNativePushState(identity.userId);
    if (state.endpoint) {
      await unregisterForIdentity(
        identity,
        epoch,
        state.endpoint,
        state.optedOut
      );
    }
  });
}
