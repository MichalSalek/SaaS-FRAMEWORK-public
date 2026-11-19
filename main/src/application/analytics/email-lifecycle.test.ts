import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import { usePostHogReadinessStore } from './posthog-readiness.store';
import {
  appendLifecycleToCallback,
  captureLifecycleFromUrl,
  lifecycleActionProperties,
  readPendingLifecycle,
  saveLifecycleAttribution,
  setLifecycleEntryValidation,
  withLifecycleActionProperties,
} from './email-lifecycle';

const messageId = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';
const context = {
  accountId: 'stylist-account',
  messageId,
  entryId,
  ctaId: 'primary',
  enteredAt: new Date().toISOString(),
  family: 'free',
  ruleId: 'free-first-photo',
  templateId: 'free-first-photo',
  locale: 'pl',
  cohort: 'new',
  provider: 'resend',
};

describe('email lifecycle attribution', () => {
  beforeEach(() => {
    localStorage.clear();
    useCookieConsentStore.setState({ consent: null });
    usePostHogReadinessStore.setState({ identifiedUserId: 'owner' });
  });
  it('captures an opaque marker before login and keeps the same visit across auth and refresh', () => {
    captureLifecycleFromUrl(
      `https://nailfolio.app/app?nf_message=${messageId}&nf_cta=primary`
    );
    const pending = readPendingLifecycle();
    expect(pending?.messageId).toBe(messageId);
    captureLifecycleFromUrl(
      `https://nailfolio.app/app?nf_message=${messageId}&nf_cta=primary`
    );
    expect(readPendingLifecycle()?.entryId).toBe(pending?.entryId);
    const callback = new URL(
      appendLifecycleToCallback('https://nailfolio.app/en/app?auth=x')
    );
    expect(callback.searchParams.get('nf_message')).toBe(messageId);
    expect(callback.searchParams.get('auth')).toBe('x');
    expect(localStorage.getItem(STORAGE_KEYS.FIRST_TOUCH)).toBeNull();
  });
  it('rejects malformed or expired markers', () => {
    captureLifecycleFromUrl(
      'https://nailfolio.app/app?nf_message=not-a-uuid&nf_cta=primary'
    );
    expect(readPendingLifecycle()).toBeNull();
    localStorage.setItem(
      STORAGE_KEYS.EMAIL_LIFECYCLE_PENDING,
      JSON.stringify({
        messageId,
        entryId,
        ctaId: 'primary',
        capturedAt: Date.now() - 8 * 86400000,
      })
    );
    expect(readPendingLifecycle()).toBeNull();
  });
  it('attributes only the latest validated entry within seven days and marks 24-hour results separately', () => {
    saveLifecycleAttribution(context, 'owner');
    expect(lifecycleActionProperties()).toMatchObject({
      lifecycle_message_id: messageId,
      lifecycle_within_24h: true,
    });
    expect(lifecycleActionProperties(Date.now() + 2 * 86400000)).toMatchObject({
      lifecycle_within_24h: false,
      lifecycle_within_7d: true,
    });
    expect(lifecycleActionProperties(Date.now() + 8 * 86400000)).toEqual({});
  });
  it('holds only analytics while the first interaction ownership validation is in flight', async () => {
    let settle: () => void = () => undefined;
    const validation = new Promise<void>(resolve => {
      settle = resolve;
    });
    setLifecycleEntryValidation(validation);
    const emit = vi.fn();
    withLifecycleActionProperties(emit);
    expect(emit).not.toHaveBeenCalled();
    saveLifecycleAttribution(
      { ...context, enteredAt: new Date(Date.now() - 100).toISOString() },
      'owner'
    );
    settle();
    await validation;
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle_message_id: messageId })
    );
  });
  it('never attributes an action of another signed-in user or after analytics opt-out', () => {
    saveLifecycleAttribution(context, 'other-owner');
    expect(lifecycleActionProperties()).toEqual({});
    saveLifecycleAttribution(context, 'owner');
    useCookieConsentStore.setState({
      consent: { necessary: true, analytics: false, marketing: false },
    });
    expect(lifecycleActionProperties()).toEqual({});
  });
});
