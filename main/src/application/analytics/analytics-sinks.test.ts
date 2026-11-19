import { afterEach, describe, expect, it, vi } from 'vitest';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('./posthog-client', () => ({ capturePosthog: capture }));

import { clarity, emitAnalyticsEvent } from './analytics-sinks';

interface DataLayerWindow extends Window {
  dataLayer?: Record<string, unknown>[];
}

const dataLayerWindow = window as DataLayerWindow;

describe('analytics sinks', () => {
  afterEach(() => {
    delete dataLayerWindow.dataLayer;
    capture.mockClear();
  });

  it('writes known keys as undefined when an event does not carry them', () => {
    emitAnalyticsEvent('cta_click', { location: 'home-hero' });

    const event = dataLayerWindow.dataLayer?.[0];
    expect(event?.['location']).toBe('home-hero');
    expect(event?.['plan']).toBeUndefined();
    expect(event?.['role']).toBeUndefined();
    expect(event?.['billing_period']).toBeUndefined();
    expect(event?.['first_source']).toBeUndefined();
    expect(event?.['event']).toBe('cta_click');
  });

  it('clears market properties on the next unrelated event', () => {
    emitAnalyticsEvent('pricing_plan_clicked', {
      billing_country: 'CA',
      currency: 'USD',
      billing_period: 'year',
    });
    emitAnalyticsEvent('cta_click', { location: 'home-hero' });
    const merged = Object.assign({}, ...(dataLayerWindow.dataLayer ?? []));
    expect(merged).toMatchObject({
      billing_country: undefined,
      currency: undefined,
      billing_period: undefined,
    });
  });

  it('keeps the current event values in both sinks', () => {
    emitAnalyticsEvent('demo_interaction', {
      demo: 'chat',
      demo_action: 'row_scroll',
      demo_value: 'sample',
    });

    expect(capture).toHaveBeenCalledWith(
      'demo_interaction',
      expect.objectContaining({ demo: 'chat', demo_action: 'row_scroll' })
    );
    expect(dataLayerWindow.dataLayer?.[0]).toMatchObject({
      event: 'demo_interaction',
      demo: 'chat',
      demo_action: 'row_scroll',
      demo_value: 'sample',
    });
  });

  it('sends nothing to either sink for own traffic', () => {
    document.cookie = 'nf_internal=1; Path=/';
    try {
      emitAnalyticsEvent('cta_click', { location: 'home-hero' });
      clarity('set', 'cta_clicked', 'home-hero');
    } finally {
      document.cookie = 'nf_internal=; Path=/; Max-Age=0';
    }

    expect(capture).not.toHaveBeenCalled();
    expect(dataLayerWindow.dataLayer).toBeUndefined();
    expect(
      (window as unknown as { clarity?: unknown }).clarity
    ).toBeUndefined();
  });
});
