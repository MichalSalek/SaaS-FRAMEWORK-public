import { afterEach, describe, expect, it, vi } from 'vitest';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('./posthog-client', () => ({ capturePosthog: capture }));

import { saveLifecycleAttribution } from './email-lifecycle';
import { usePostHogReadinessStore } from './posthog-readiness.store';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import { FLOW_STEPS, trackFlowStep } from './flow-events';

type ClarityWindow = Window & { clarity?: { q?: unknown[][] } };

describe('trackFlowStep', () => {
  afterEach(() => {
    capture.mockClear();
    localStorage.clear();
    usePostHogReadinessStore.setState({ identifiedUserId: null });
    delete (window as ClarityWindow).clarity;
  });

  it('sends `<flow>_<step>` with flow and step as properties', () => {
    trackFlowStep('upload', 'published', { source: 'camera' });
    expect(capture).toHaveBeenCalledWith(
      'upload_published',
      expect.objectContaining({
        flow: 'upload',
        step: 'published',
        source: 'camera',
      })
    );
  });

  it('marks the step in Clarity so a recording can be filtered by it', () => {
    trackFlowStep('session', 'shared');
    expect((window as ClarityWindow).clarity?.q).toContainEqual([
      'event',
      'session_shared',
    ]);
  });

  it('never attributes another stylist connection to the current client actor mail', () => {
    usePostHogReadinessStore.setState({ identifiedUserId: 'actor' });
    useCookieConsentStore.setState({ consent: null });
    saveLifecycleAttribution(
      {
        accountId: 'actors-stylist-account',
        messageId: 'own-mail',
        entryId: 'own-entry',
        ctaId: 'primary',
        enteredAt: new Date().toISOString(),
        family: 'free',
        ruleId: 'free-first-client',
        templateId: 'free-first-client',
        locale: 'pl',
        cohort: 'new',
        provider: 'resend',
      },
      'actor'
    );
    trackFlowStep('pairing', 'request_accepted');
    expect(capture).toHaveBeenLastCalledWith(
      'pairing_request_accepted',
      expect.not.objectContaining({ lifecycle_message_id: 'own-mail' })
    );
  });

  it('keeps step names unique and snake_case inside each flow', () => {
    for (const steps of Object.values(FLOW_STEPS)) {
      expect(new Set(steps).size).toBe(steps.length);
      for (const step of steps) {
        expect(step).toMatch(/^[a-z]+(_[a-z]+)*$/);
      }
    }
  });
});
