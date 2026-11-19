import { createOncePerPageViewGuard } from './analytics-contract';
import { clarity, emitAnalyticsEvent } from './analytics-sinks';

export type DemoName = 'gallery-filter' | 'reviews' | 'chat' | 'session-pick';
export type DemoAction = 'filter_tap' | 'expand' | 'row_scroll' | 'photo_tap';

const interactionGuard = createOncePerPageViewGuard();

export function resetDemoInteractionGuard(): void {
  interactionGuard.reset();
}

export function trackDemoInteraction(
  demo: DemoName,
  action: DemoAction,
  value?: string
): void {
  const guardKey = JSON.stringify([demo, action, value]);
  if (!interactionGuard.mark(guardKey)) {
    return;
  }

  emitAnalyticsEvent('demo_interaction', {
    demo,
    demo_action: action,
    demo_value: value,
  });
  clarity('set', 'demo_used', demo);
}
