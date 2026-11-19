import { clarity, emitAnalyticsEvent } from './analytics-sinks';
import { getFirstTouchEventProperties, updateFirstTouch } from './first-touch';

export type AuthStartedMethod = 'magic_link' | 'google';
export type AuthIntent = 'register' | 'login';

export function trackAuthStarted(
  method: AuthStartedMethod,
  intent: AuthIntent
): void {
  updateFirstTouch({ method });
  const firstTouch = getFirstTouchEventProperties();
  emitAnalyticsEvent('auth_started', {
    method,
    intent,
    first_cta: firstTouch.first_cta,
  });
  clarity('set', 'auth_started', method);
}
