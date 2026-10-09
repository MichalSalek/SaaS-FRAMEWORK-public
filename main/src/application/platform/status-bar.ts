/**
 * Pasek statusu w skorupie natywnej dopasowany do ŻYWEJ palety aplikacji.
 *
 * Bez tego ikony paska zostają na domyślnej polaryzacji, więc po przełączeniu
 * motywu potrafią zniknąć we własnym tle (ciemne ikony na ciemnej belce).
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-09, zmierzone na emulatorze
 * Android 16, `targetSdkVersion = 35`, WebView ładujący front ze zdalnego
 * origin (most Capacitora wstrzykuje skorupa):
 *
 *   1. NIE ZWRACAJ proxy pluginu z funkcji `async`. Proxy z `registerPlugin`
 *      odpowiada NA KAŻDĄ nazwę właściwości, więc `typeof proxy.then ===
 *      'function'` (zmierzone). Promise zwracany przez `async` traktuje taką
 *      wartość jak thenable i woła `proxy.then(resolve, reject)` — czyli metodę
 *      `then` NA MOŚCIE NATYWNYM, której żaden plugin nie implementuje.
 *      Callback nigdy nie wraca, promise NIGDY SIĘ NIE ROZSTRZYGA i cała
 *      inicjalizacja cicho umiera na `await`. Dokładnie to blokowało ten moduł:
 *      efekt się montował, plugin się rozwiązywał, a MutationObserver nie
 *      powstawał nigdy. Dlatego resolver oddaje proxy OPAKOWANE w zwykły obiekt
 *      `{ plugin }` — opakowanie nie jest thenable. To nie jest ozdobnik.
 *   2. `setStyle` DZIAŁA i to ona załatwia realny problem (kontrast ikon):
 *      zweryfikowane przez `getInfo()` po `setStyle({ style: 'DARK' })`.
 *   3. `setBackgroundColor` JEST NO-OPEM OD ANDROIDA 15+ — zmierzone: po
 *      `setBackgroundColor({ color: '#7a1f3d' })` `getInfo()` dalej raportuje
 *      `color: "#000000"`. Nie ma błędu, wywołanie po prostu nic nie robi:
 *      przy `targetSdk 35` Android 15+ wymusza edge-to-edge, pasek jest
 *      przezroczysty i maluje pod nim treść aplikacji. NIE „naprawiaj"
 *      konwersji koloru goniąc wynik, którego system nigdy nie da. Wywołanie
 *      zostaje wyłącznie jako best-effort dla Androida ≤14, gdzie pasek ma
 *      własne tło i sam `setStyle` dałby ciemne ikony na czarnej belce.
 *   4. Skoro jedynym konsumentem hexa jest API będące no-opem na najnowszych
 *      Androidach, kolor liczymy JEDNYM mechanizmem: rasteryzacją 1×1 na
 *      canvasie. Poprzednia drabinka (parser hex → parser rgb() → sonda przez
 *      getComputedStyle → canvas) była pod tę stawkę przerostem: canvas i tak
 *      przyjmuje wszystkie te składnie, łącznie z tą, którą token faktycznie ma
 *      na urządzeniu (`lab(95.38% 1.05011 4.44876)` → `#f7f1e9`, zmierzone).
 *   5. Tryb czytamy z DOM (`data-mode` na <html>, RESOLVED do light|dark przez
 *      ThemeContext / zero-flash), a NIE przez useTheme() — `application/` NIE
 *      może importować z `UI/` (kierunek zależności UI/→application/). To ta
 *      sama, udokumentowana furtka co w AppSnackbars.controller.tsx.
 *   6. Kolor bierzemy z tokenu `--color-bg-main` policzonego na <html>, NIGDY
 *      z zaszytego hexa: SSOT palety to `UI/styles/themes/palettes.css`
 *      (rouge-papier), a zaszyty kolor rozjechałby się przy zmianie palety.
 *      Gdy odczyt padnie, ustawiamy sam styl treści i odpuszczamy tło — nigdy
 *      nie zgadujemy koloru.
 *   7. Polaryzacja stylu jest ODWROTNA do intuicji i zweryfikowana w d.ts
 *      pluginu (`@capacitor/status-bar` → `Style`): `Dark = "DARK"` znaczy
 *      JASNY TEKST dla ciemnego tła, `Light = "LIGHT"` znaczy CIEMNY TEKST dla
 *      jasnego tła. Stąd data-mode='dark' → 'DARK'.
 *
 * Kontrakt: nigdy nie rzuca, zawsze zwraca funkcję odsubskrybowania. Plugin nie
 * jest zależnością `main` — mieszka w skorupie, adresujemy go nazwą przez
 * `registerPlugin` (wzorzec z `screen-brightness.ts`).
 */

type StatusBarStyle = 'DARK' | 'LIGHT' | 'DEFAULT';

interface StatusBarPlugin {
  setStyle(options: { style: StatusBarStyle }): Promise<void>;
  setBackgroundColor(options: { color: string }): Promise<void>;
}

const BACKGROUND_TOKEN = '--color-bg-main';

/**
 * Sentinel odróżnia „canvas odrzucił wartość" od „kolor naprawdę taki jest":
 * `fillStyle` po cichu ignoruje składnię, której nie zna, i zostaje przy
 * poprzedniej wartości. Bez tej kontroli nieznany token dałby czerń — czyli
 * dokładnie tę czarną belkę, dla której ten moduł powstał.
 */
const CANVAS_SENTINEL = '#010203';

function readBackgroundHex(): string | null {
  try {
    const raw = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(BACKGROUND_TOKEN)
      .trim();
    if (raw.length === 0) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context == null) {
      return null;
    }
    context.fillStyle = CANVAS_SENTINEL;
    context.fillStyle = raw;
    if (context.fillStyle === CANVAS_SENTINEL && raw !== CANVAS_SENTINEL) {
      return null;
    }
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    const channel = (value: number) => value.toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  } catch {
    return null;
  }
}

function isDarkMode(): boolean {
  return document.documentElement.getAttribute('data-mode') === 'dark';
}

/**
 * Zwraca proxy OPAKOWANE w obiekt — patrz DECISION §1. Spłaszczenie sygnatury
 * do `Promise<StatusBarPlugin | null>` zawiesza tę funkcję na zawsze.
 */
async function resolveStatusBarPlugin(): Promise<{
  plugin: StatusBarPlugin;
} | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable('StatusBar')
    ) {
      return null;
    }
    return { plugin: registerPlugin<StatusBarPlugin>('StatusBar') };
  } catch {
    return null;
  }
}

async function applyStatusBarTheme(plugin: StatusBarPlugin): Promise<void> {
  try {
    await plugin.setStyle({ style: isDarkMode() ? 'DARK' : 'LIGHT' });
  } catch {
    // Pasek statusu to wzbogacenie — brak reakcji systemu nic nie psuje.
  }
  const color = readBackgroundHex();
  if (color == null) {
    return;
  }
  try {
    // Best-effort dla Androida ≤14. Na 15+ to zmierzony no-op (DECISION §3).
    await plugin.setBackgroundColor({ color });
  } catch {
    // Brak implementacji w skorupie — cicho odpuszczamy.
  }
}

export function initStatusBarTheming(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  let disposed = false;
  let observer: MutationObserver | null = null;

  void (async () => {
    const resolved = await resolveStatusBarPlugin();
    if (resolved == null || disposed) {
      return;
    }
    const apply = () => {
      void applyStatusBarTheme(resolved.plugin);
    };
    apply();
    observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributeFilter: ['data-mode'],
    });
    if (disposed) {
      observer.disconnect();
      observer = null;
    }
  })();

  return () => {
    disposed = true;
    observer?.disconnect();
    observer = null;
  };
}
