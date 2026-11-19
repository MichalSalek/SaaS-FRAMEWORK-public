import {
  isAppZonePath,
  readLocalePrefix,
  stripLocalePrefix,
} from '@kernel/domain/routing/app-path.utils';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

type PushRoute = { path: string; locale: string | undefined };

/** Only same-origin app routes are allowed; keep the notification ID and anchor. */
export function resolvePushRoute(value: unknown, origin: string): PushRoute {
  const fallback = { path: ROUTES_FRONT.NOTIFICATIONS, locale: undefined };
  if (typeof value !== 'string' || value.startsWith('//')) {
    return fallback;
  }
  try {
    const url = new URL(value, origin);
    const base = new URL(origin);
    // Capacitor's custom scheme has a null URL.origin, so compare its scheme and host too.
    if (
      url.protocol !== base.protocol ||
      url.host !== base.host ||
      url.username ||
      url.password ||
      !isAppZonePath(url.pathname)
    ) {
      return fallback;
    }
    return {
      path: `${stripLocalePrefix(url.pathname)}${url.search}${url.hash}`,
      locale: readLocalePrefix(url.pathname) ?? undefined,
    };
  } catch {
    return fallback;
  }
}

/** The probe confirms a listener is ready; navigation remains guarded separately. */
export function handlePushOpenMessage(
  value: unknown,
  origin: string,
  navigate: (path: string, locale: string | undefined) => void,
  acknowledge: () => void
): boolean {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  if (value.type === 'nf-push-probe') {
    acknowledge();
    return true;
  }
  if (value.type !== 'nf-push-open') {
    return false;
  }
  const route = resolvePushRoute(
    'url' in value ? value.url : undefined,
    origin
  );
  navigate(route.path, route.locale);
  return true;
}
