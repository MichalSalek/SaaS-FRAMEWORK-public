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
    // DECISION (nie usuwaj tego komentarza):
    // PROAKTYWNY guard. Natywna skorupa (remote-load wrapper) może nie zawierać
    // pluginu Haptics — `isPluginAvailable('Haptics')` to idiomatyczny Capacitor
    // check zwracający false ZAMIAST pozwolić, by `Haptics.impact()` rzucił
    // "Haptics plugin is not implemented on android" przy wywołaniu mostka (Capacitor
    // potrafi zalogować error do natywnej konsoli ZANIM rzuci — sam try/catch tego
    // szumu nie eliminuje). try/catch w funkcjach niżej zostaje jako defense-in-depth
    // (np. urządzenie bez silnika haptycznego, gdzie plugin JEST, ale wywołanie pada).
    if (!Capacitor.isPluginAvailable('Haptics')) {
      return null;
    }
    const { Haptics } = await import('@capacitor/haptics');
    // DECISION (nie usuwaj tego komentarza) — zmierzone 2026-09-09:
    // Plugin WRACA OPAKOWANY W OBIEKT. `Haptics` to Proxy z `registerPlugin`,
    // którego handler `get` obsługuje `$$typeof`, `toJSON`, `addListener` i
    // `removeListener`, a KAŻDĄ inną nazwę zamienia na wywołanie mostka — więc
    // `Haptics.then` jest funkcją i całe proxy jest „thenable". Zwrócone wprost
    // z funkcji `async` zostaje potraktowane jak obietnica: runtime woła na
    // mostku metodę `then`, której żaden plugin nie implementuje, odpowiedź nie
    // wraca i obietnica NIGDY się nie rozstrzyga. Cały kod po `await` jest wtedy
    // martwy — cicho, bo haptyka jest fire-and-forget.
    // Do 2026-09-09 ta pułapka była nieosiągalna, bo `isPluginAvailable` zwracało
    // na originie zdalnym false i wychodziliśmy linijkę wyżej. Odkąd skorupa
    // dowozi mostek, ta ścieżka jest ŻYWA. Obiekt-opakowanie thenable nie jest.
    // NIE „upraszczaj" tego z powrotem do `return Haptics`.
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
    // DECISION (nie usuwaj tego komentarza):
    // Natywny wrapper może NIE zawierać pluginu Haptics — `isNativePlatform()`
    // jest wtedy true (Capacitor WebView) i import JS przechodzi, ale wywołanie
    // mostka rzuca "Haptics plugin is not implemented on android". try/catch w
    // getHapticsPlugin() chroni TYLKO import/detekcję, NIE wywołanie metody, więc
    // łapiemy też tutaj. Cichy no-op: haptyka to progressive enhancement.
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
    // Plugin niezaimplementowany w natywnym wrapperze / nieobsługiwany — cichy
    // no-op (patrz DECISION w hapticImpact).
  }
}
