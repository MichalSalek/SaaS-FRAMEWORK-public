/**
 * Native share sheet utility.
 * Falls back to clipboard copy on web.
 */

import { copyText } from './clipboard';

interface ShareOptions {
  title?: string;
  text?: string;
  url: string;
}

/**
 * Which channel ACTUALLY worked: the caller picks feedback per channel (the „skopiowano" toast ONLY
 * for 'clipboard'; after the native sheet / web share the system gave its own feedback). `false` =
 * nothing happened (cancel / error), so no success feedback.
 *
 * DECISION: the former boolean merged the channels, and CANCELLING the native sheet (Capacitor
 * Share.share REJECTS "Share canceled" on Android) fell through to the clipboard: the link was
 * copied without the user's consent and the caller showed a false "copied" toast. A rejected
 * native share no longer falls back to the clipboard.
 */
export type ShareOutcome = 'native' | 'web' | 'clipboard' | false;

export async function shareContent(
  options: ShareOptions
): Promise<ShareOutcome> {
  let isNative = false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    isNative = Capacitor.isNativePlatform();
  } catch {
    // Capacitor unavailable (plain web build): take the web path.
  }

  if (isNative) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        ...(options.title ? { title: options.title } : {}),
        ...(options.text ? { text: options.text } : {}),
        url: options.url,
        ...(options.title ? { dialogTitle: options.title } : {}),
      });
      return 'native';
    } catch {
      // A cancelled sheet (or plugin error) on NATIVE ends here; it does not fall back to the clipboard.
      return false;
    }
  }

  // Web fallback: navigator.share or clipboard
  if (navigator.share != null) {
    try {
      await navigator.share({
        ...(options.title ? { title: options.title } : {}),
        ...(options.text ? { text: options.text } : {}),
        url: options.url,
      });
      return 'web';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return false;
      }
    }
  }

  // Last resort: clipboard through the shared helper (native goes over the bridge, where
  // `navigator.clipboard` is unreliable).
  return (await copyText(options.url)) ? 'clipboard' : false;
}
