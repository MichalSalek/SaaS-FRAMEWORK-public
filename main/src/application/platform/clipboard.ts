/**
 * Copy text to the clipboard: the one entry point for the whole app.
 *
 * DECISION: `navigator.clipboard.writeText` in the Android WebView is sometimes unavailable or
 * refuses (no secure context in some shell setups, permission policy, no gesture). The native
 * shell exposes a `Clipboard` plugin, so on a native platform we go THROUGH THE BRIDGE and the web
 * API stays as the fallback. The order is deliberate: the native clipboard also works where
 * `navigator.clipboard` exists but throws on write.
 *
 * Contract: never throws. `true` = the text really reached the clipboard (the caller may show a
 * "copied" toast), `false` = it failed (error toast). The plugin is not a `main` dependency, it
 * lives in the shell and is addressed by name via `registerPlugin` (same pattern as
 * `screen-brightness.ts`).
 */

interface ClipboardPlugin {
  write(options: { string: string }): Promise<void>;
}

async function copyViaNativePlugin(text: string): Promise<boolean> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable('Clipboard')
    ) {
      return false;
    }
    const plugin = registerPlugin<ClipboardPlugin>('Clipboard');
    await plugin.write({ string: text });
    return true;
  } catch {
    // Brak mostka / plugin nieobecny w skorupie — schodzimy na ścieżkę web.
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (await copyViaNativePlugin(text)) {
    return true;
  }

  try {
    if (
      typeof navigator === 'undefined' ||
      navigator.clipboard == null ||
      typeof navigator.clipboard.writeText !== 'function'
    ) {
      return false;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
