// Sonner-based toast bridge. Subscribes to the Zustand snackbar queue,
// translates event-name keys via `useTranslations('events')`, and forwards
// the result to Sonner's imperative `toast.<color>()` API. After dispatch
// the head item is removed from the queue so the next push fires.

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast, Toaster } from 'sonner';
import type { SnackbarWrapper } from '../appSnackbar.types';
import { SNACKBAR_MAX_SNACKS, SNACKBAR_TIMEOUT } from '../appSnackbar.config';
import { SnackbarMessageMolecule } from './SnackbarMessage.molecule';
import { useSnackbarStore } from '../appSnackbar.store';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  loadEventsMessages,
  type EventsMessages,
} from '../../i18n/events-messages';

export const AppSnackbarsController = (): ReactElement => {
  const snackbarsCollection = useSnackbarStore(state => state.snackbars);
  const shift = useSnackbarStore(state => state.shift);
  const t = useTranslations('events');
  // Public pages do not ship `events` (DECISION at getPublicPageMessages in
  // i18n.loader.ts): the first toast loads it, and the queue waits for it.
  // DECISION: probe the namespace through `t.has` on a key every events file must carry
  // (respondForbidden's baked-in default, held by audit:i18n` (events-coverage)), never through
  // `useMessages()`: useMessages THROWS when the provider got no messages (a poisoned data
  // response), and this controller is mounted on every page, so the throw took the whole app down
  // to the error boundary. A translator over a missing namespace answers `has` with false.
  const hasEagerEvents = t.has(APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO);
  const locale = useLocale();
  const [lazyEvents, setLazyEvents] = useState<{
    locale: string;
    messages: EventsMessages;
  } | null>(null);
  const lazyMessages =
    lazyEvents?.locale === locale ? lazyEvents.messages : null;
  // Glass toasts are mode-aware: theme (below) sets data-sonner-theme, and the --color-* tokens
  // (on <html>[data-mode]) paint the frosted glass from global.css. Without it Sonner renders the
  // light skin (default theme='light'), so toasts are „too bright" in dark.
  //
  // DECISION: read the mode from the DOM (`data-mode` on <html>, resolved to light|dark by
  // ThemeContext/zero-flash), NOT via useTheme(): `application/` must not import from `UI/`
  // (no-restricted-imports). A re-render on snackbar-store changes refreshes the value for new
  // toasts; an already visible toast switches reactively anyway (the CSS tokens on <html> change at
  // once on a theme toggle).
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
      // DECISION: pushNewSnackbar has TWO modes: an event key (APP_EVENTS.INFO.* / response.event),
      // translated through 'events', and a pre-translated string (t('foo.bar')), rendered as-is.
      // next-intl v4 does NOT throw on a missing key, it returns the fallback 'events.<input>', so a
      // try/catch never caught and the raw 'events.<message>' leaked to the user. t.has() recognises
      // a real event key; otherwise the string is used as-is.
      if (!hasEagerEvents) {
        return lazyMessages?.[message] ?? message;
      }
      const key = message as Parameters<typeof t>[0];
      return t.has(key) ? t(key) : message;
    },
    [t, hasEagerEvents, lazyMessages]
  );

  const waitsForEvents =
    snackbarsCollection.length > 0 && !hasEagerEvents && lazyMessages === null;
  useEffect(() => {
    if (!waitsForEvents) {
      return undefined;
    }
    let active = true;
    void loadEventsMessages(locale).then(messages => {
      if (active) {
        setLazyEvents({ locale, messages });
      }
    });
    return () => {
      active = false;
    };
  }, [waitsForEvents, locale]);

  useEffect(() => {
    if (snackbarsCollection.length === 0 || waitsForEvents) {
      return () => undefined;
    }

    const head = snackbarsCollection[0];
    const translatedMessage = translateEventMessage(head.message);
    const srLabel = TOAST_SR_LABELS[head.color];
    // DECISION: an active toast is deduplicated by a stable Sonner `id`, NOT by a timer in
    // pushNewSnackbar. TanStack Query's default 1000 ms retry landed exactly after a 1-second memo
    // cleared, and an A→B→A interleave slipped past a single lastSnackbarMemo. The same raw
    // event / pre-translated message keeps the same id for the toast's lifetime, so a repeat updates
    // the visible toast instead of stacking a duplicate. The id is the TRANSLATED text, so an event
    // key and a screen string that read the same collapse too (the raw key and t('…') never matched).
    const toastId = `app-snackbar:${translatedMessage}`;
    // Wrap in JSX: visually hidden sr-prefix + visible message text.
    // Screen readers announce both; sighted users see only translatedMessage.
    toast[head.color](
      <SnackbarMessageMolecule label={srLabel} message={translatedMessage} />,
      {
        id: toastId,
        duration: head.color === 'success' ? 4000 : SNACKBAR_TIMEOUT,
      }
    );

    // Drop the head so the next queued snackbar can fire on the next render.
    shift();

    return () => undefined;
  }, [
    snackbarsCollection,
    waitsForEvents,
    translateEventMessage,
    shift,
    TOAST_SR_LABELS,
  ]);

  return (
    // Top-center (owner): at the bottom toasts ALWAYS covered the bottom nav; at the top they have
    // free space under the AppBar. Offset = AppBar height + breathing room + notch safe area (iOS).
    //
    // Dismissal = SWIPE ONLY (owner): no close "X". Sonner supports swipe-to-dismiss natively;
    // left/right is the natural "sweep away" gesture, and 'top' joins as the natural upward flick
    // at top-center (the toast no longer collides with the scroll/OS nav gesture that ruled out
    // 'bottom' at the bottom).
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
      // Sonner v2: `offset` applies at >=600px, mobile takes `mobileOffset` (without it the toast
      // landed 16px from the top, ON the AppBar).
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
