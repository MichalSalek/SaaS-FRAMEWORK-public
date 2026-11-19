import { beforeEach, describe, expect, it, vi } from 'vitest';
const { readActions, capture } = vi.hoisted(() => ({
  readActions: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('./emailIO.possibilities.api', () => ({
  getLifecycleActions_IO: readActions,
}));
vi.mock('../../application/analytics/posthog-client', () => ({
  capturePosthog: capture,
}));
import {
  confirmedConnectionProperties,
  syncConfirmedLifecycleActions,
} from './email-lifecycle-actions.analytics';
import { usePostHogReadinessStore } from '../../application/analytics/posthog-readiness.store';
import { useCookieConsentStore } from '../../application/stores/cookieConsent.store';
const occurredAt = new Date().toISOString();
const action = {
  id: '11111111-1111-4111-8111-111111111111',
  accountId: 'stylist-account',
  occurredAt,
  attribution: {
    accountId: 'stylist-account',
    messageId: 'stylist-mail',
    entryId: 'stylist-entry',
    ctaId: 'primary',
    enteredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    family: 'free',
    ruleId: 'free-first-client',
    templateId: 'free-first-client',
    locale: 'pl',
    cohort: 'new',
    provider: 'resend',
  },
};

describe('consent-gated stylist confirmation replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCookieConsentStore.setState({ consent: null });
    usePostHogReadinessStore.setState({ identifiedUserId: 'target-stylist' });
    readActions.mockResolvedValue({ actions: [action], nextCursor: null });
  });
  it('requires matching server-confirmed account and measures the actual action time, not the later visit', () => {
    expect(confirmedConnectionProperties(action)).toMatchObject({
      lifecycle_message_id: 'stylist-mail',
      lifecycle_within_24h: false,
      lifecycle_within_7d: true,
    });
    expect(
      confirmedConnectionProperties({ ...action, accountId: 'other-stylist' })
    ).toEqual({});
  });
  it('does not read or emit receipts when analytics is disabled', async () => {
    useCookieConsentStore.setState({
      consent: { necessary: true, analytics: false, marketing: false },
    });
    await syncConfirmedLifecycleActions(true);
    expect(readActions).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
  it('emits the target stylist event once with original stable identity, then ignores repeated visits', async () => {
    await syncConfirmedLifecycleActions(true);
    await syncConfirmedLifecycleActions(true);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      'pairing_request_accepted',
      expect.objectContaining({ lifecycle_message_id: 'stylist-mail' }),
      { uuid: action.id, timestamp: new Date(occurredAt) }
    );
  });
  it('drops the result if the identified user switches while the request is pending', async () => {
    let resolve: (value: {
      actions: (typeof action)[];
      nextCursor: null;
    }) => void = () => undefined;
    readActions.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    const request = syncConfirmedLifecycleActions(true);
    await Promise.resolve();
    usePostHogReadinessStore.setState({ identifiedUserId: 'client-actor' });
    resolve({
      actions: [{ ...action, id: '22222222-2222-4222-8222-222222222222' }],
      nextCursor: null,
    });
    await request;
    expect(capture).not.toHaveBeenCalled();
  });
});
