import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_IDENTITY_WILL_CHANGE_EVENT } from '../../application/auth/auth-token-teardown';
import {
  createHistoryScrollCoordinator,
  noteScrollOption,
  readGalleryLayout,
  rememberGalleryLayout,
} from './history-scroll';

let main: HTMLElement;
let maxScroll: number;

function entry(key: string, path: string): void {
  history.replaceState({ key, __N: true }, '', path);
}

beforeEach(() => {
  vi.useFakeTimers();
  entry('a', '/app/account');
  document.body.innerHTML = '<main id="main-content"><div></div></main>';
  main = document.getElementById('main-content') as HTMLElement;
  maxScroll = 2000;
  Object.defineProperty(main, 'scrollTo', {
    value: vi.fn((options: ScrollToOptions) => {
      main.scrollTop = Math.min(options.top ?? 0, maxScroll);
    }),
  });
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function toB(
  coordinator: ReturnType<typeof createHistoryScrollCoordinator>
): void {
  coordinator.start('/app/data');
  entry('b', '/app/data');
  coordinator.complete('/app/data');
  main.scrollTop = 0;
}

function backA(
  coordinator: ReturnType<typeof createHistoryScrollCoordinator>
): void {
  entry('a', '/app/account');
  coordinator.acceptedPop();
  coordinator.start('/app/account');
  coordinator.complete('/app/account');
  vi.advanceTimersByTime(30);
}

describe('history scroll coordinator', () => {
  it('restores by history entry and retains a clamped target across another visit', () => {
    const coordinator = createHistoryScrollCoordinator();
    main.scrollTop = 1000;
    toB(coordinator);
    maxScroll = 300;
    backA(coordinator);
    expect(main.scrollTop).toBe(300);
    toB(coordinator);
    maxScroll = 2000;
    backA(coordinator);
    expect(main.scrollTop).toBe(1000);
    coordinator.dispose();
  });

  it('remembers gallery layout per entry and clears it across identity changes', () => {
    const coordinator = createHistoryScrollCoordinator();
    rememberGalleryLayout('own-gallery', 'tiles');
    expect(readGalleryLayout('own-gallery')).toBe('tiles');
    coordinator.start('/app/other');
    entry('b', '/app/other');
    coordinator.complete('/app/other');
    expect(readGalleryLayout('own-gallery')).toBeNull();
    entry('a', '/app/account');
    coordinator.acceptedPop();
    coordinator.start('/app/account');
    coordinator.complete('/app/account');
    expect(readGalleryLayout('own-gallery')).toBe('tiles');
    window.dispatchEvent(new Event(AUTH_IDENTITY_WILL_CHANGE_EVENT));
    expect(readGalleryLayout('own-gallery')).toBeNull();
    rememberGalleryLayout('own-gallery', 'tiles');
    expect(readGalleryLayout('own-gallery')).toBeNull();
    coordinator.dispose();
  });

  it('preserves an unreached target after a navigation click without a scroll', () => {
    const coordinator = createHistoryScrollCoordinator();
    main.scrollTop = 900;
    toB(coordinator);
    maxScroll = 250;
    backA(coordinator);
    window.dispatchEvent(new Event('pointerdown'));
    toB(coordinator);
    maxScroll = 2000;
    backA(coordinator);
    expect(main.scrollTop).toBe(900);
    coordinator.dispose();
  });

  it('keeps separate history entries for the same path', () => {
    const coordinator = createHistoryScrollCoordinator();
    main.scrollTop = 120;
    coordinator.start('/app/account?view=two');
    entry('b', '/app/account?view=two');
    coordinator.complete('/app/account?view=two');
    main.scrollTop = 480;
    backA(coordinator);
    expect(main.scrollTop).toBe(120);
    entry('b', '/app/account?view=two');
    coordinator.acceptedPop();
    coordinator.start('/app/account?view=two');
    coordinator.complete('/app/account?view=two');
    vi.advanceTimersByTime(30);
    expect(main.scrollTop).toBe(480);
    coordinator.dispose();
  });

  it('keeps the user position when a wheel interrupts a clamped restore', () => {
    const coordinator = createHistoryScrollCoordinator();
    main.scrollTop = 1000;
    toB(coordinator);
    maxScroll = 300;
    backA(coordinator);
    window.dispatchEvent(new Event('wheel'));
    main.scrollTop = 125;
    toB(coordinator);
    maxScroll = 2000;
    backA(coordinator);
    expect(main.scrollTop).toBe(125);
    coordinator.dispose();
  });

  it('ignores a superseded completion or failure and does not leak scroll:false', () => {
    const coordinator = createHistoryScrollCoordinator();
    const clearA = noteScrollOption('/app/old', false);
    coordinator.start('/app/old');
    noteScrollOption('/app/new', true);
    clearA();
    coordinator.start('/app/new');
    expect(coordinator.fail('/app/old')).toBe(false);
    expect(coordinator.complete('/app/old')).toBeNull();
    entry('b', '/app/new');
    expect(coordinator.complete('/app/new')).toBe(false);
    coordinator.dispose();
  });

  it('an older promise cannot clear the newer scroll:false option', () => {
    const coordinator = createHistoryScrollCoordinator();
    const clearOld = noteScrollOption('/app/old', false);
    noteScrollOption('/app/new', false);
    clearOld();
    coordinator.start('/app/new');
    entry('b', '/app/new');
    expect(coordinator.complete('/app/new')).toBe(true);
    coordinator.dispose();
  });

  it('cancels an already scheduled restore when identity changes', () => {
    const coordinator = createHistoryScrollCoordinator();
    main.scrollTop = 180;
    toB(coordinator);
    entry('a', '/app/account');
    coordinator.acceptedPop();
    coordinator.start('/app/account');
    coordinator.complete('/app/account');
    window.dispatchEvent(new Event(AUTH_IDENTITY_WILL_CHANGE_EVENT));
    vi.advanceTimersByTime(30);
    expect(main.scrollTop).toBe(0);
    coordinator.dispose();
  });

  it('does not recapture the previous identity on pagehide or its next navigation', () => {
    const coordinator = createHistoryScrollCoordinator();
    main.scrollTop = 180;
    toB(coordinator);
    main.scrollTop = 260;
    window.dispatchEvent(new Event(AUTH_IDENTITY_WILL_CHANGE_EVENT));
    window.dispatchEvent(new Event('pagehide'));
    coordinator.start('/app/next');
    entry('c', '/app/next');
    coordinator.complete('/app/next');
    main.scrollTop = 0;
    entry('b', '/app/data');
    coordinator.acceptedPop();
    coordinator.start('/app/data');
    expect(coordinator.complete('/app/data')).toBe(false);
    vi.advanceTimersByTime(30);
    expect(main.scrollTop).toBe(0);
    coordinator.dispose();
  });

  it('clears saved positions on identity change, while pagehide leaves them intact', () => {
    const coordinator = createHistoryScrollCoordinator();
    main.scrollTop = 180;
    toB(coordinator);
    window.dispatchEvent(new Event('pagehide'));
    backA(coordinator);
    expect(main.scrollTop).toBe(180);
    toB(coordinator);
    window.dispatchEvent(new Event(AUTH_IDENTITY_WILL_CHANGE_EVENT));
    backA(coordinator);
    expect(main.scrollTop).toBe(0);
    coordinator.dispose();
  });
});
