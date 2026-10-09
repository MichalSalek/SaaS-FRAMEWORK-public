/**
 * Kopiowanie tekstu do schowka — jedno wejście dla całej aplikacji.
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-09:
 * `navigator.clipboard.writeText` w Android WebView bywa niedostępne albo
 * odmawia (brak secure-context w części konfiguracji skorupy, polityka
 * uprawnień, brak gestu). Skorupa natywna wystawia plugin `Clipboard`, więc
 * na natywnej platformie idziemy PRZEZ MOSTEK, a web-owe API zostaje jako
 * fallback. Kolejność jest celowa: natywny schowek działa również tam, gdzie
 * `navigator.clipboard` istnieje, ale rzuca przy zapisie.
 *
 * Kontrakt: nigdy nie rzuca. `true` = tekst realnie trafił do schowka (wołający
 * może pokazać toast „skopiowano"), `false` = nie udało się (toast błędu).
 * Plugin nie jest zależnością `main` — mieszka w skorupie, adresujemy go nazwą
 * przez `registerPlugin` (ten sam wzorzec co `screen-brightness.ts`).
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
