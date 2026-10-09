// Leave guard: pure decision + registry/prompt lifecycle (jsdom history).
// The router seam and the dialog host are thin adapters over these calls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEAVE_BYPASS_MS,
  bypassLeaveGuard,
  confirmDiscard,
  confirmDiscardIfDirty,
  decideLeave,
  getLeavePrompt,
  interceptLeaveOnPopState,
  isLeaveBypassed,
  isLeaveGuardArmed,
  noteLeaveGuardHistoryEntry,
  registerLeaveGuard,
  requestLeave,
  resetLeaveGuardForTests,
  resolveLeavePrompt,
  resolveTargetPathname,
  subscribeLeavePrompt,
} from './leave-guard';

const flushMicrotasks = () => Promise.resolve();

beforeEach(() => {
  resetLeaveGuardForTests();
  window.history.replaceState(null, '', '/app/gallery/upload');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('decideLeave', () => {
  const base = {
    guarded: true,
    bypassed: false,
    currentPathname: '/app/gallery/upload',
  };

  it('allows everything while no guard is active', () => {
    expect(
      decideLeave({ ...base, guarded: false, targetPathname: '/app' })
    ).toBe('allow');
  });

  it('allows a confirmed (bypassed) leave', () => {
    expect(decideLeave({ ...base, bypassed: true, targetPathname: null })).toBe(
      'allow'
    );
  });

  it('blocks another screen and an unknown (back) destination', () => {
    expect(decideLeave({ ...base, targetPathname: '/app' })).toBe('block');
    expect(decideLeave({ ...base, targetPathname: null })).toBe('block');
  });

  it('allows query, hash, trailing slash and locale changes of the same screen', () => {
    for (const target of [
      '/app/gallery/upload?step=2',
      '/app/gallery/upload#main-content',
      '/app/gallery/upload/',
      '/en/app/gallery/upload',
    ]) {
      expect(decideLeave({ ...base, targetPathname: target })).toBe('allow');
    }
  });
});

describe('resolveTargetPathname', () => {
  it('keeps plain paths and extracts the path of absolute urls', () => {
    expect(resolveTargetPathname('/app?x=1', '/')).toBe('/app?x=1');
    expect(resolveTargetPathname('https://nailfolio.app/app/home', '/')).toBe(
      '/app/home'
    );
  });

  it('resolves relative strings against the current screen', () => {
    expect(resolveTargetPathname('?tab=x', '/app/admin/config')).toBe(
      '/app/admin/config'
    );
    expect(resolveTargetPathname('#top', '/app/admin/config')).toBe(
      '/app/admin/config'
    );
    expect(resolveTargetPathname('notes', '/app/admin/config')).toBe(
      '/app/admin/notes'
    );
    expect(resolveTargetPathname('//cdn.example/x', '/app')).toBe('/x');
  });

  it('fills dynamic segments of url objects from the query', () => {
    expect(
      resolveTargetPathname(
        { pathname: '/stylist/[id]', query: { id: '42' } },
        '/'
      )
    ).toBe('/stylist/42');
    expect(
      resolveTargetPathname(
        { pathname: '/blog/[...slug]', query: { slug: ['a', 'b'] } },
        '/'
      )
    ).toBe('/blog/a/b');
    expect(resolveTargetPathname({ query: { q: 'x' } }, '/app/admin')).toBe(
      '/app/admin'
    );
  });
});

describe('registry', () => {
  it('arms while a guard is registered and disarms on release', async () => {
    expect(isLeaveGuardArmed()).toBe(false);
    const release = registerLeaveGuard('draft');
    expect(isLeaveGuardArmed()).toBe(true);
    release();
    await flushMicrotasks();
    expect(isLeaveGuardArmed()).toBe(false);
  });

  it('never blocks without a guard', () => {
    const proceed = vi.fn();
    expect(requestLeave('/app', proceed)).toBe(true);
    expect(getLeavePrompt()).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
  });
});

describe('push-origin leave', () => {
  it('blocks, prompts with the active message and proceeds on confirm', () => {
    registerLeaveGuard('older');
    registerLeaveGuard('photo will be lost');
    const proceed = vi.fn();
    const listener = vi.fn();
    subscribeLeavePrompt(listener);

    expect(requestLeave('/app', proceed)).toBe(false);
    expect(getLeavePrompt()?.message).toBe('photo will be lost');
    expect(getLeavePrompt()?.kind).toBe('leave');
    expect(listener).toHaveBeenCalled();

    resolveLeavePrompt('confirm');
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(getLeavePrompt()).toBeNull();
    // The re-issued navigation passes on the one-shot bypass.
    expect(requestLeave('/app', vi.fn())).toBe(true);
    expect(isLeaveBypassed()).toBe(true);
  });

  it('stays on cancel and re-arms after the bypass window', () => {
    vi.useFakeTimers();
    registerLeaveGuard('draft');
    const proceed = vi.fn();
    requestLeave('/app', proceed);
    resolveLeavePrompt('cancel');
    expect(proceed).not.toHaveBeenCalled();
    expect(isLeaveGuardArmed()).toBe(true);

    requestLeave('/app', vi.fn());
    resolveLeavePrompt('confirm');
    expect(isLeaveGuardArmed()).toBe(false);
    vi.advanceTimersByTime(LEAVE_BYPASS_MS + 1);
    expect(isLeaveGuardArmed()).toBe(true);
  });

  it('a second leave attempt while the dialog is open dismisses it (Android back)', () => {
    registerLeaveGuard('draft');
    const first = vi.fn();
    requestLeave('/app', first);
    expect(requestLeave(null, vi.fn())).toBe(false);
    expect(getLeavePrompt()).toBeNull();
    expect(first).not.toHaveBeenCalled();
  });

  it('closes the dialog when the last guard unmounts mid-dialog', async () => {
    const release = registerLeaveGuard('draft');
    const proceed = vi.fn();
    requestLeave('/app', proceed);
    release();
    await flushMicrotasks();
    expect(getLeavePrompt()).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
    expect(requestLeave('/app', vi.fn())).toBe(true);
  });

  it('keeps the dialog when a guard only re-registers (message change)', async () => {
    const release = registerLeaveGuard('draft');
    requestLeave('/app', vi.fn());
    release();
    registerLeaveGuard('draft v2');
    await flushMicrotasks();
    expect(getLeavePrompt()).not.toBeNull();
  });

  it('a released guard leaves no stale bypass behind', async () => {
    const release = registerLeaveGuard('draft');
    requestLeave('/app', vi.fn());
    resolveLeavePrompt('confirm');
    expect(isLeaveBypassed()).toBe(true);
    release();
    await flushMicrotasks();
    expect(isLeaveBypassed()).toBe(false);
  });
});

describe('popstate leave', () => {
  it('restores the current entry, prompts, and goes back on confirm', () => {
    window.history.replaceState(
      { __N: true, as: '/app/gallery/upload', key: 'b' },
      '',
      '/app/gallery/upload'
    );
    registerLeaveGuard('draft');
    // The browser already moved to the previous entry.
    window.history.replaceState(
      { __N: true, as: '/app', key: 'a' },
      '',
      '/app'
    );
    const pushState = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    expect(interceptLeaveOnPopState('/app')).toBe(true);
    expect(pushState).toHaveBeenCalledWith(
      { __N: true, as: '/app/gallery/upload', key: 'b' },
      '',
      `${window.location.origin}/app/gallery/upload`
    );
    expect(window.location.pathname).toBe('/app/gallery/upload');
    expect(getLeavePrompt()?.kind).toBe('leave');

    resolveLeavePrompt('confirm');
    expect(back).toHaveBeenCalledTimes(1);
    // The confirmed back itself is let through.
    expect(interceptLeaveOnPopState('/app')).toBe(false);
    pushState.mockRestore();
    back.mockRestore();
  });

  it('lets same-screen history moves and unguarded pages through', () => {
    noteLeaveGuardHistoryEntry();
    expect(interceptLeaveOnPopState('/app')).toBe(false);
    registerLeaveGuard('draft');
    expect(interceptLeaveOnPopState('/app/gallery/upload?step=2')).toBe(false);
  });
});

describe('in-screen discard', () => {
  it('resolves true without asking when clean', async () => {
    await expect(confirmDiscardIfDirty(false, 'x')).resolves.toBe(true);
    expect(getLeavePrompt()).toBeNull();
  });

  it('asks with the discard kind and resolves the choice', async () => {
    const answer = confirmDiscard('note draft');
    expect(getLeavePrompt()?.kind).toBe('discard');
    resolveLeavePrompt('cancel');
    await expect(answer).resolves.toBe(false);

    const second = confirmDiscardIfDirty(true, 'note draft');
    resolveLeavePrompt('confirm');
    await expect(second).resolves.toBe(true);
  });
});

describe('system navigation', () => {
  it('passes an armed guard and closes an open dialog', () => {
    const release = registerLeaveGuard('Szkic zniknie.');
    expect(requestLeave('/app', () => undefined)).toBe(false);
    expect(getLeavePrompt()).not.toBeNull();

    bypassLeaveGuard();

    expect(getLeavePrompt()).toBeNull();
    expect(requestLeave('/user/login', () => undefined)).toBe(true);
    expect(isLeaveBypassed()).toBe(true);
    release();
  });

  it('settles an open discard prompt as cancel', async () => {
    const release = registerLeaveGuard('Szkic zniknie.');
    const answer = confirmDiscard('Odrzucić zmiany?');

    bypassLeaveGuard();

    await expect(answer).resolves.toBe(false);
    release();
  });

  it('opens no pass when no guard is active', () => {
    bypassLeaveGuard();
    expect(isLeaveBypassed()).toBe(false);

    const release = registerLeaveGuard('Szkic zniknie.');
    expect(requestLeave('/app', () => undefined)).toBe(false);
    release();
  });
});
