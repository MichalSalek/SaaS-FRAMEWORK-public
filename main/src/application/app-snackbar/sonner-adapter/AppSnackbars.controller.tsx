// Sonner-based toast bridge. Subscribes to the Zustand snackbar queue,
// translates event-name keys via `useTranslations('events')`, and forwards
// the result to Sonner's imperative `toast.<color>()` API. After dispatch
// the head item is removed from the queue so the next push fires.

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo } from 'react';
import { toast, Toaster } from 'sonner';
import type { SnackbarWrapper } from '../appSnackbar.types';
import { SNACKBAR_MAX_SNACKS, SNACKBAR_TIMEOUT } from '../appSnackbar.config';
import { useSnackbarStore } from '../appSnackbar.store';

export const AppSnackbarsController = (): ReactElement => {
  const snackbarsCollection = useSnackbarStore(state => state.snackbars);
  const shift = useSnackbarStore(state => state.shift);
  const t = useTranslations('events');
  // Glass toasts są mode-aware: theme (niżej) ustawia data-sonner-theme, a tokeny
  // --color-* (na <html>[data-mode]) malują frosted glass z global.css. Bez tego
  // Sonner renderuje light-skin (default theme='light') → toasty „za jasne" w dark.
  //
  // DECISION (nie usuwaj): mode czytamy z DOM (`data-mode` na <html>, RESOLVED do
  // light|dark przez ThemeContext/zero-flash), NIE przez useTheme() — `application/`
  // NIE może importować z `UI/` (kierunek zależności UI/→application/,
  // no-restricted-imports). Re-render na zmiany snackbar-store odświeża wartość dla
  // nowych toastów; już-widoczny toast i tak przełącza tło/kolory reaktywnie (tokeny
  // CSS na <html> zmieniają się natychmiast przy toggle motywu).
  const resolvedMode: 'light' | 'dark' =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-mode') === 'dark'
      ? 'dark'
      : 'light';
  const tA11y = useTranslations('a11y');

  // B1-F7: Screen-reader type prefix per toast variant (WCAG 1.3.1 / 4.1.3).
  // Sonner does not expose ariaLabel on individual toasts (only containerAriaLabel).
  // SR_ONLY span prepended to visible message text: visually hidden via inline style,
  // announced before the message by screen readers for type context.
  const TOAST_SR_LABELS = useMemo<Record<SnackbarWrapper['color'], string>>(
    () => ({
      success: tA11y('toast.success'),
      error: tA11y('toast.error'),
      info: tA11y('toast.info'),
      warning: tA11y('toast.warning'),
    }),
    [tA11y]
  );

  const translateEventMessage = useCallback(
    (message: string): string => {
      // DECISION (nie usuwaj — S18 systemic fix): pushNewSnackbar ma DWA tryby:
      // (1) event-key (APP_EVENTS.INFO.* / response.event) -> tlumacz przez 'events',
      // (2) pre-translated string (t('foo.bar')) -> renderuj as-is.
      // next-intl v4 NIE rzuca dla brakujacego klucza — zwraca fallback
      // 'events.<input>', wiec stary try/catch nigdy nie lapal i SUROWY
      // 'events.Nie udalo sie...' wyciekal do usera (admin users/notes/logs/...).
      // t.has() rozpoznaje realny event-key; jak nie istnieje -> string as-is.
      const key = message as Parameters<typeof t>[0];
      return t.has(key) ? t(key) : message;
    },
    [t]
  );

  useEffect(() => {
    if (snackbarsCollection.length === 0) {
      return () => undefined;
    }

    const head = snackbarsCollection[0];
    const translatedMessage = translateEventMessage(head.message);
    const srLabel = TOAST_SR_LABELS[head.color];
    // DECISION (nie usuwaj tego komentarza): aktywny toast jest deduplikowany
    // stabilnym Sonner `id`, a NIE timerem w pushNewSnackbar. Retry TanStack Query
    // ma domyślnie 1000 ms i trafiał dokładnie po wyczyszczeniu starego 1-sekundowego
    // memo; interleaving A→B→A dodatkowo omijał pojedyncze lastSnackbarMemo. Ten sam
    // surowy event/pre-translated message ma ten sam id przez cały czas życia toasta,
    // więc kolejne wywołanie aktualizuje widoczny toast zamiast układać duplikat.
    const toastId = `app-snackbar:${head.message}`;
    // Wrap in JSX: visually hidden sr-prefix + visible message text.
    // Screen readers announce both; sighted users see only translatedMessage.
    toast[head.color](
      <span>
        <span
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            whiteSpace: 'nowrap',
          }}>
          {srLabel}
        </span>
        {translatedMessage}
      </span>,
      {
        id: toastId,
        duration: SNACKBAR_TIMEOUT,
      }
    );

    // Drop the head so the next queued snackbar can fire on the next render.
    shift();

    return () => undefined;
  }, [snackbarsCollection, translateEventMessage, shift, TOAST_SR_LABELS]);

  return (
    // Top-center (głos ownera 2026-07-11): na dole toasty ZAWSZE zasłaniały
    // bottom nav — u góry mają wolną przestrzeń pod AppBarem. Offset =
    // wysokość AppBara + oddech + notch safe-area (iOS).
    //
    // Dismissal = SWIPE ONLY (user 2026-06-25): no close "X". Sonner supports
    // swipe-to-dismiss natively; left/right is the natural "sweep away" gesture,
    // 'top' dochodzi jako naturalny rzut w górę przy top-center (toast nie
    // koliduje już ze scroll/OS nav-gesture, które wykluczały 'bottom' na dole).
    //
    // theme={resolvedMode} — mode-aware skin (root-cause of "too bright in dark":
    // Sonner defaults to theme='light'). Frosted-glass visuals live in global.css
    // ([data-sonner-toast]); colors come from --color-* tokens, so the glass is
    // automatically light/dark correct.
    <Toaster
      closeButton={false}
      theme={resolvedMode}
      richColors={false}
      position={'top-center'}
      // Sonner v2: `offset` działa na >=600px, mobile bierze `mobileOffset`
      // (bez niego toast lądował 16px od góry, NA AppBarze — QA S50b).
      offset={{
        top: 'calc(var(--app-bar-height) + var(--space-12) + env(safe-area-inset-top))',
      }}
      mobileOffset={{
        top: 'calc(var(--app-bar-height) + var(--space-12) + env(safe-area-inset-top))',
      }}
      visibleToasts={SNACKBAR_MAX_SNACKS}
      expand={true}
      swipeDirections={['left', 'right', 'top']}
    />
  );
};
