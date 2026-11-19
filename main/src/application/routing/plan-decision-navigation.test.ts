import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasPlanDecision,
  hasPlanDecisionOwner,
  interceptPlanDecisionPopState,
  isPlanDecisionRouterSettled,
  planDecisionUrl,
  registerPlanDecisionOwner,
} from './plan-decision-navigation';

let releases: Array<() => void> = [];

it('waits for the router query while accepting locale prefixes and query ordering', () => {
  expect(
    isPlanDecisionRouterSettled('/pay?promo=SAVE', '/de/pay/?promo=SAVE')
  ).toBe(true);
  expect(
    isPlanDecisionRouterSettled(
      '/pay?promo=SAVE&planDecision=1',
      '/pay?promo=SAVE'
    )
  ).toBe(false);
  expect(isPlanDecisionRouterSettled('/pay?a=1&b=2', '/en/pay/?b=2&a=1')).toBe(
    true
  );
});

beforeEach(() => {
  window.history.replaceState(
    { page: 'decision' },
    '',
    '/pay?promo=SAVE&planDecision=1#billing'
  );
  releases = [];
});
afterEach(() => releases.forEach(release => release()));

function register(isLocked: () => boolean, onHistoryClose: () => void) {
  const registration = registerPlanDecisionOwner({ isLocked, onHistoryClose });
  releases.push(registration.release);
  return registration;
}

describe('plan decision navigation', () => {
  it('adds and removes only the presentation flag, preserving query and hash', () => {
    const initial = '/pay?promo=SAVE%20NOW&source=mail#billing';
    const open = planDecisionUrl(initial, true);
    const openedUrl = new URL(open, window.location.origin);
    expect(openedUrl.searchParams.get('promo')).toBe('SAVE NOW');
    expect(openedUrl.searchParams.get('source')).toBe('mail');
    expect(openedUrl.hash).toBe('#billing');
    expect(hasPlanDecision(open)).toBe(true);
    const closedUrl = new URL(
      planDecisionUrl(open, false),
      window.location.origin
    );
    expect(closedUrl.searchParams.get('promo')).toBe('SAVE NOW');
    expect(closedUrl.searchParams.get('source')).toBe('mail');
    expect(closedUrl.hash).toBe('#billing');
    expect(hasPlanDecision(closedUrl.href)).toBe(false);
  });

  it('closes once on an idle pop and lets the router handle both events', () => {
    const close = vi.fn();
    register(() => false, close);
    window.history.replaceState({ page: 'pay' }, '', '/pay?promo=SAVE#billing');
    expect(interceptPlanDecisionPopState('/pay?promo=SAVE#billing')).toBe(
      false
    );
    expect(interceptPlanDecisionPopState('/pay?promo=SAVE#billing')).toBe(
      false
    );
    expect(close).toHaveBeenCalledOnce();
    expect(hasPlanDecisionOwner()).toBe(false);
  });

  it('restores the snapshot and retains the owner on a locked pop', () => {
    const close = vi.fn();
    register(() => true, close);
    window.history.replaceState({ page: 'pay' }, '', '/pay?promo=SAVE#billing');
    expect(interceptPlanDecisionPopState('/pay?promo=SAVE#billing')).toBe(true);
    expect(
      window.location.pathname + window.location.search + window.location.hash
    ).toBe('/pay?promo=SAVE&planDecision=1#billing');
    expect(window.history.state).toEqual({ page: 'decision' });
    expect(hasPlanDecisionOwner()).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps the decision open when the same path still carries the flag', () => {
    const close = vi.fn();
    register(() => false, close);
    expect(
      interceptPlanDecisionPopState('/pay?promo=OTHER&planDecision=1#new')
    ).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(hasPlanDecisionOwner()).toBe(true);
  });

  it('does not let an earlier owner release a newer owner', () => {
    const first = register(() => false, vi.fn());
    const closeNew = vi.fn();
    register(() => false, closeNew);
    first.release();
    expect(hasPlanDecisionOwner()).toBe(true);
    expect(interceptPlanDecisionPopState('/pay?promo=SAVE')).toBe(false);
    expect(closeNew).toHaveBeenCalledOnce();
  });
});
