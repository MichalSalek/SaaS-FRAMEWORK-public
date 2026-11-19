/**
 * Haptic feedback utility for native platforms.
 *
 * All functions are no-ops on web AND a graceful no-op on native builds whose
 * wrapper does not bundle the Capacitor Haptics plugin (Capacitor throws
 * "Haptics plugin is not implemented on android/ios" at CALL time, not at
 * import) — safe to call unconditionally, they never throw. Haptics are a
 * progressive enhancement; a missing plugin or unsupported device must never
 * surface as a runtime error.
 */

type ImpactStyle = 'Heavy' | 'Medium' | 'Light';

async function getHapticsPlugin() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    // DECISION: PROACTIVE guard. The native shell (remote-load wrapper) may lack the Haptics
    // plugin; `isPluginAvailable('Haptics')` is the idiomatic Capacitor check and returns false
    // INSTEAD OF letting `Haptics.impact()` throw "Haptics plugin is not implemented on android" at
    // the bridge call (Capacitor may log the error to the native console BEFORE throwing, which a
    // try/catch alone does not silence). The try/catch below stays as defense in depth (a device
    // without a haptic engine where the plugin IS present but the call fails).
    if (!Capacitor.isPluginAvailable('Haptics')) {
      return null;
    }
    const { Haptics } = await import('@capacitor/haptics');
    // DECISION: the plugin is returned WRAPPED IN AN OBJECT. `Haptics` is a `registerPlugin` Proxy
    // whose `get` handler answers `$$typeof`, `toJSON`, `addListener` and `removeListener` and turns
    // EVERY other name into a bridge call, so `Haptics.then` is a function and the proxy is
    // "thenable". Returned straight from an `async` function it is treated as a promise: the runtime
    // calls a `then` method on the bridge that no plugin implements, the answer never returns and
    // the promise NEVER settles, silently killing all code after the `await` (haptics is
    // fire-and-forget). Reachable since the shell ships the bridge on the remote origin. A wrapper
    // object is not thenable. Do NOT "simplify" back to `return Haptics`.
    return { plugin: Haptics };
  } catch {
    return null;
  }
}

export async function hapticImpact(
  style: ImpactStyle = 'Medium'
): Promise<void> {
  try {
    const haptics = await getHapticsPlugin();
    if (!haptics) {
      return;
    }
    const { ImpactStyle: Styles } = await import('@capacitor/haptics');
    await haptics.plugin.impact({ style: Styles[style] });
  } catch {
    // DECISION: the native wrapper may lack the Haptics plugin: `isNativePlatform()` is then true
    // and the JS import succeeds, but the bridge call throws "Haptics plugin is not implemented on
    // android". The try/catch in getHapticsPlugin() guards only import/detection, not the method
    // call, so we catch here too. Silent no-op: haptics is progressive enhancement.
  }
}

export async function hapticNotification(
  type: 'Success' | 'Warning' | 'Error' = 'Success'
): Promise<void> {
  try {
    const haptics = await getHapticsPlugin();
    if (!haptics) {
      return;
    }
    const { NotificationType } = await import('@capacitor/haptics');
    await haptics.plugin.notification({ type: NotificationType[type] });
  } catch {
    // Plugin not implemented in the native wrapper or unsupported: silent
    // no-op (see the DECISION in hapticImpact).
  }
}
