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
 * Który kanał FAKTYCZNIE zadziałał — caller dobiera feedback do kanału
 * (np. toast „skopiowano" TYLKO dla 'clipboard'; po natywnym sheecie /
 * web-share system dał własny feedback). `false` = nic się nie wydarzyło
 * (anulowanie / błąd) — bez feedbacku sukcesu.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Wcześniejszy boolean zlewał kanały i ANULOWANIE natywnego sheeta
 * (Capacitor Share.share REJECTUJE „Share canceled" na Androidzie) leciało
 * fallthrough do clipboardu: link kopiował się bez zgody usera, a caller
 * pokazywał fałszywy toast „skopiowano" (review S51). Odrzucenie natywnego
 * share NIE spada już do clipboardu.
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
    // Capacitor niedostępny (czysty web build) — jedziemy web-ścieżką.
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
      // Anulowany sheet (lub błąd pluginu) na NATIVE = koniec, nie clipboard.
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

  // Last resort: clipboard (przez wspólny helper — na natywnej platformie idzie
  // mostkiem, `navigator.clipboard` jest tam zawodne).
  return (await copyText(options.url)) ? 'clipboard' : false;
}
