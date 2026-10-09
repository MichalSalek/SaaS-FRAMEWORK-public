/**
 * Clarity session tagging runs from the app, not from GTM Custom HTML (s34):
 * the production CSP blocks inline tags, so the GTM versions never ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

import { trackCtaClick, trackSignupStarted } from './cta-events';

type Queued = ((...args: unknown[]) => void) & { q?: unknown[][] };
const w = window as unknown as { clarity?: Queued };

describe('Clarity tagging from CTA events', () => {
  afterEach(() => {
    delete w.clarity;
  });

  it('queues the tag before Clarity has loaded (nothing is lost)', () => {
    trackCtaClick('home-hero');
    expect(w.clarity?.q).toEqual([
      ['set', 'cta_clicked', 'home-hero'],
      ['event', 'cta_click'],
    ]);
  });

  it('calls a loaded Clarity directly and upgrades signup sessions', () => {
    const calls: unknown[][] = [];
    w.clarity = (...args: unknown[]) => {
      calls.push(args);
    };
    trackSignupStarted('pricing-tier');
    expect(calls).toEqual([
      ['set', 'signup_started', 'true'],
      ['upgrade', 'signup_started'],
    ]);
  });
});
