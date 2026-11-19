/**
 * Save a PNG from a data URL: the one entry point for "download" buttons.
 *
 * DECISION: `<a download>` on a blob URL is a SILENT NO-OP in the Android WebView. The click fires,
 * no exception is thrown and the file is never created, so the "Download PNG" button for the
 * stylist's permanent QR code did nothing while looking like success. On a native platform the file
 * is therefore written through the `Filesystem` plugin (DOCUMENTS directory), and the web path
 * (dataURL → atob → Blob → objectURL → <a> in DOM → click) stays unchanged for browsers.
 *
 * Contract: never throws. Returns the CHANNEL the file really left through ('native' | 'web') or
 * `false` when nothing worked; the caller picks the message per channel (native must say WHERE the
 * file landed, since the user sees no browser download bar). The plugin is not a `main` dependency,
 * it lives in the native shell and is addressed by name via `registerPlugin` (pattern from
 * `screen-brightness.ts`).
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
  /** Full data URL, e.g. `data:image/png;base64,iVBOR...`. */
  dataUrl: string;
  /** File name including the extension. */
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
 * Whether we are in the native shell WITH the Filesystem plugin available.
 *
 * DECISION: this question is SEPARATE from the write itself because on a native platform the web
 * path is FORBIDDEN as a fallback. `<a download>` in the Android WebView does not throw, so a
 * native → web fallback would return `'web'` (success) exactly when no file was written,
 * recreating the silent failure this module exists to remove. On native the only allowed results
 * are `'native'` or `false`.
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
      // Native, but the shell lacks the plugin (see the DECISION above): report no channel and do
      // not fall back to the anchor.
      return null;
    }
    // DECISION: the plugin is WRAPPED IN AN OBJECT on purpose. The `registerPlugin` proxy answers
    // ANY property name, so `typeof proxy.then === 'function'`; returning it straight from an
    // `async` function makes the runtime treat it as a thenable and call a native-bridge method
    // named `then` that no plugin implements. The promise NEVER settles and all code after the
    // `await` is dead. A plain wrapper object is not thenable. Do NOT "simplify" to the bare proxy.
    return { plugin: registerPlugin<FilesystemPlugin>('Filesystem') };
  } catch {
    return null;
  }
}

/** Whether the platform is native, regardless of plugin availability. */
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
    // Permission denied, no space, plugin error: an honest `false`; the caller shows the error.
    // No silent fallback to the anchor.
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
    // Appending to the DOM is required: `.click()` on a detached <a> is a no-op in some browsers.
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
  // Native but without the plugin: the anchor would write nothing and report a false success
  // (see the DECISION at resolveNativeFilesystem).
  if (await isNativeShell()) {
    return false;
  }
  return writeViaWebAnchor(options) ? 'web' : false;
}
