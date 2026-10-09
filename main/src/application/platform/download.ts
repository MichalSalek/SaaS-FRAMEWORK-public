/**
 * Zapis pliku PNG z data-URL-a — jedno wejście dla przycisków „pobierz".
 *
 * DECISION (nie usuwaj tego komentarza) — zmierzone 2026-09-09:
 * `<a download>` na blob-URL-u jest CICHYM NO-OP w Android WebView. Kliknięcie
 * faktycznie leci, żaden wyjątek nie wypada, a plik nigdy nie powstaje. Efekt:
 * przycisk „Pobierz PNG" przy stałym kodzie QR stylistki w aplikacji nie robił
 * nic, jednocześnie wyglądając na sukces (kod po `a.click()` szedł dalej i
 * zliczał zdarzenie dystrybucji). Dlatego na natywnej platformie zapisujemy
 * plik przez plugin `Filesystem` (katalog DOCUMENTS), a ścieżka web
 * (dataURL → atob → Blob → objectURL → <a> w DOM → click) zostaje bez zmian
 * dla przeglądarki.
 *
 * Kontrakt: nigdy nie rzuca. Zwraca KANAŁ, którym plik realnie wyszedł
 * ('native' | 'web'), albo `false`, gdy nic się nie udało — wołający dobiera
 * komunikat do kanału (natywny musi powiedzieć GDZIE plik wylądował, bo user
 * nie widzi paska pobierania przeglądarki).
 *
 * Plugin nie jest zależnością `main` — mieszka w skorupie natywnej, adresujemy
 * go nazwą przez `registerPlugin` (wzorzec z `screen-brightness.ts`).
 */

interface FilesystemPlugin {
  writeFile(o: {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
  }): Promise<{ uri: string }>;
}

export type DownloadOutcome = 'native' | 'web' | false;

interface DownloadPngOptions {
  /** Pełny data-URL, np. `data:image/png;base64,iVBOR...`. */
  dataUrl: string;
  /** Nazwa pliku razem z rozszerzeniem. */
  filename: string;
}

/** Odcina prefiks `data:<mime>;base64,` — plugin przyjmuje surowy base64. */
function extractBase64(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) {
    return null;
  }
  const payload = dataUrl.slice(comma + 1);
  return payload.length > 0 ? payload : null;
}

function extractMime(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const meta = comma === -1 ? dataUrl : dataUrl.slice(0, comma);
  return meta.match(/:(.*?);/)?.[1] ?? 'image/png';
}

/**
 * Czy jesteśmy w skorupie natywnej Z dostępnym pluginem Filesystem.
 *
 * DECISION (nie usuwaj tego komentarza): to pytanie jest ODDZIELONE od samego
 * zapisu, bo na natywnej platformie NIE WOLNO zejść na ścieżkę web. `<a download>`
 * w Android WebView nie rzuca — kliknięcie „się udaje" i nie powstaje żaden plik.
 * Fallback native → web zwróciłby więc `'web'` (sukces) dokładnie w sytuacji, w
 * której plik nie wyszedł, czyli odtworzyłby cichy błąd, dla którego ten moduł
 * powstał. Na natywnej platformie jedyne dopuszczalne wyniki to `'native'` albo
 * `false`.
 */
async function resolveNativeFilesystem(): Promise<{
  plugin: FilesystemPlugin;
} | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    if (!Capacitor.isPluginAvailable('Filesystem')) {
      // Natywnie, ale skorupa nie niesie pluginu — patrz DECISION wyżej:
      // sygnalizujemy to jako brak kanału, nie schodzimy na kotwicę.
      return null;
    }
    // DECISION (nie usuwaj tego komentarza) — zmierzone 2026-09-09:
    // Plugin JEST OPAKOWANY W OBIEKT CELOWO. Proxy z `registerPlugin` odpowiada
    // na DOWOLNĄ nazwę właściwości, więc `typeof proxy.then === 'function'`.
    // Zwrócenie go wprost z funkcji `async` sprawia, że runtime traktuje je jak
    // thenable i woła na mostku natywnym metodę o nazwie `then`, której żaden
    // plugin nie implementuje: odpowiedź nigdy nie wraca, obietnica NIGDY się nie
    // rozstrzyga, a cały kod po `await` jest martwy. Zwykły obiekt-opakowanie
    // thenable nie jest. NIE „upraszczaj" tego z powrotem do gołego proxy.
    return { plugin: registerPlugin<FilesystemPlugin>('Filesystem') };
  } catch {
    return null;
  }
}

/** Czy platforma jest natywna (niezależnie od dostępności pluginu). */
async function isNativeShell(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function writeViaNativePlugin(
  plugin: FilesystemPlugin,
  options: DownloadPngOptions
): Promise<boolean> {
  const data = extractBase64(options.dataUrl);
  if (data == null) {
    return false;
  }
  try {
    await plugin.writeFile({
      path: options.filename,
      data,
      directory: 'DOCUMENTS',
      recursive: true,
    });
    return true;
  } catch {
    // Odmowa uprawnień, brak miejsca, błąd pluginu — uczciwe `false`,
    // wołający pokaże błąd. Bez cichego zejścia na kotwicę.
    return false;
  }
}

function writeViaWebAnchor(options: DownloadPngOptions): boolean {
  try {
    const base64 = extractBase64(options.dataUrl);
    if (base64 == null || typeof document === 'undefined') {
      return false;
    }
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: extractMime(options.dataUrl) });
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = options.filename;
    // Append do DOM jest konieczny: `.click()` na oderwanym <a> to no-op
    // w części przeglądarek.
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
    return true;
  } catch {
    return false;
  }
}

export async function downloadPngDataUrl(
  options: DownloadPngOptions
): Promise<DownloadOutcome> {
  const native = await resolveNativeFilesystem();
  if (native != null) {
    return (await writeViaNativePlugin(native.plugin, options))
      ? 'native'
      : false;
  }
  // Natywnie, ale bez pluginu: kotwica i tak nic nie zapisze, a zwróciłaby
  // fałszywy sukces (patrz DECISION przy resolveNativeFilesystem).
  if (await isNativeShell()) {
    return false;
  }
  return writeViaWebAnchor(options) ? 'web' : false;
}
