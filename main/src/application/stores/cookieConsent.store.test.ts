import { beforeEach, describe, expect, it } from 'vitest';
import { useCookieConsentStore } from './cookieConsent.store';

describe('account analytics preference', () => {
  beforeEach(() => useCookieConsentStore.setState({ consent: null }));

  it('keeps undecided analytics active and changes only analytics from the default-active consent', () => {
    expect(useCookieConsentStore.getState().consent?.analytics !== false).toBe(
      true
    );
    useCookieConsentStore.getState().setAnalytics(false);
    expect(useCookieConsentStore.getState().consent).toEqual({
      necessary: true,
      analytics: false,
      marketing: true,
    });
  });

  it.each([false, true])(
    'preserves explicit marketing=%s through both analytics changes',
    marketing => {
      useCookieConsentStore
        .getState()
        .setConsent({ analytics: true, marketing });
      useCookieConsentStore.getState().setAnalytics(false);
      expect(useCookieConsentStore.getState().consent).toEqual({
        necessary: true,
        analytics: false,
        marketing,
      });
      useCookieConsentStore.getState().setAnalytics(true);
      expect(useCookieConsentStore.getState().consent).toEqual({
        necessary: true,
        analytics: true,
        marketing,
      });
    }
  );
});
