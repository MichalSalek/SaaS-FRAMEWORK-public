import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => {
  let topSurface = '#161616';
  let bottomSurface = '#f8f8f8';
  const calls = {
    style: [] as string[],
    compatibilityBackground: [] as string[],
    systemBarSurfaces: [] as Array<{
      topColor: string;
      bottomColor: string;
      bottomIconStyle: 'light' | 'dark';
    }>,
    legacySurface: [] as string[],
  };
  return {
    calls,
    currentTopSurface: () => topSurface,
    currentBottomSurface: () => bottomSurface,
    setSurfaces: (top: string, bottom: string) => {
      topSurface = top;
      bottomSurface = bottom;
    },
    statusBar: {
      setStyle: vi.fn(async ({ style }: { style: string }) => {
        calls.style.push(style);
      }),
      setBackgroundColor: vi.fn(async ({ color }: { color: string }) => {
        calls.compatibilityBackground.push(color);
      }),
    },
    nativeChrome: {
      setStatusBarSurface: vi.fn(async ({ color }: { color: string }) => {
        calls.legacySurface.push(color);
      }),
      setSystemBarSurfaces: vi.fn(
        async (surfaces: {
          topColor: string;
          bottomColor: string;
          bottomIconStyle: 'light' | 'dark';
        }) => {
          calls.systemBarSurfaces.push(surfaces);
        }
      ),
    },
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
  registerPlugin: (name: string) =>
    name === 'StatusBar' ? native.statusBar : native.nativeChrome,
}));

vi.mock('./status-bar.surface', () => ({
  readTopSurfaceHex: () => native.currentTopSurface(),
  readBottomSurfaceHex: () => native.currentBottomSurface(),
  statusBarStyleForHex: (color: string) =>
    color === '#161616' ? 'DARK' : 'LIGHT',
  systemBarIconStyleForHex: (color: string) =>
    color === '#161616' ? 'light' : 'dark',
}));

import { initStatusBarTheming } from './status-bar';

let frameId = 0;
let frames: Map<number, FrameRequestCallback>;
let mediaListeners: Set<EventListenerOrEventListenerObject>;
let originalMatchMedia: Window['matchMedia'] | undefined;
let originalDataMode: string | null;
let routeMarkers: HTMLElement[];

function flushFrame() {
  const first = frames.entries().next().value as
    [number, FrameRequestCallback] | undefined;
  if (first == null) {
    throw new Error('Expected a scheduled animation frame');
  }
  frames.delete(first[0]);
  first[1](0);
}

async function waitForFrame() {
  await vi.waitFor(() => expect(frames.size).toBe(1), {
    interval: 5,
    timeout: 500,
  });
}

async function waitForSystemSurfaces(topColor: string, bottomColor: string) {
  await vi.waitFor(() =>
    expect(native.calls.systemBarSurfaces).toContainEqual(
      expect.objectContaining({ topColor, bottomColor })
    )
  );
}

async function waitForLegacySurface(color: string) {
  await vi.waitFor(() => expect(native.calls.legacySurface).toContain(color));
}

afterEach(() => {
  routeMarkers.forEach(marker => marker.remove());
  if (originalDataMode == null) {
    document.documentElement.removeAttribute('data-mode');
  } else {
    document.documentElement.setAttribute('data-mode', originalDataMode);
  }
  vi.restoreAllMocks();
  if (originalMatchMedia == null) {
    delete (window as unknown as { matchMedia?: Window['matchMedia'] })
      .matchMedia;
  } else {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
  }
});

describe('native status-bar theme lifecycle', () => {
  beforeEach(() => {
    native.calls.style.length = 0;
    native.calls.compatibilityBackground.length = 0;
    native.calls.systemBarSurfaces.length = 0;
    native.calls.legacySurface.length = 0;
    native.setSurfaces('#161616', '#f8f8f8');
    native.nativeChrome.setSystemBarSurfaces
      .mockReset()
      .mockImplementation(
        async (surfaces: {
          topColor: string;
          bottomColor: string;
          bottomIconStyle: 'light' | 'dark';
        }) => {
          native.calls.systemBarSurfaces.push(surfaces);
        }
      );
    native.nativeChrome.setStatusBarSurface
      .mockReset()
      .mockImplementation(async ({ color }: { color: string }) => {
        native.calls.legacySurface.push(color);
      });
    frameId = 0;
    frames = new Map();
    mediaListeners = new Set();
    originalMatchMedia = window.matchMedia;
    originalDataMode = document.documentElement.getAttribute('data-mode');
    routeMarkers = [];

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id);
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn((_, listener) => mediaListeners.add(listener)),
        removeEventListener: vi.fn((_, listener) =>
          mediaListeners.delete(listener)
        ),
      })),
    });
  });

  it('resamples a fullscreen panel when its own scroller moves under the insets', async () => {
    const panel = document.createElement('section');
    routeMarkers.push(panel);
    document.body.appendChild(panel);
    const cleanup = initStatusBarTheming();
    await waitForFrame();
    flushFrame();
    await waitForSystemSurfaces('#161616', '#f8f8f8');

    native.setSurfaces('#ffffff', '#f8f8f8');
    panel.dispatchEvent(new Event('scroll', { bubbles: false }));
    await waitForFrame();
    flushFrame();
    await waitForSystemSurfaces('#ffffff', '#f8f8f8');

    cleanup();
    panel.dispatchEvent(new Event('scroll', { bubbles: false }));
    await Promise.resolve();
    expect(frames.size).toBe(0);
  });

  it('samples both insets, independently deduplicates them, falls back for older wrappers, and cleans up', async () => {
    const cleanup = initStatusBarTheming();

    await waitForFrame();
    flushFrame();
    await waitForSystemSurfaces('#161616', '#f8f8f8');
    expect(native.calls.style).toEqual(['DARK']);
    expect(native.statusBar.setBackgroundColor).toHaveBeenCalledWith({
      color: '#161616',
    });
    expect(native.calls.systemBarSurfaces).toEqual([
      {
        topColor: '#161616',
        bottomColor: '#f8f8f8',
        bottomIconStyle: 'dark',
      },
    ]);

    document.documentElement.setAttribute('data-mode', 'dark');
    await waitForFrame();
    flushFrame();
    await Promise.resolve();
    expect(native.calls.systemBarSurfaces).toHaveLength(1);

    native.nativeChrome.setSystemBarSurfaces.mockRejectedValueOnce(
      new Error('legacy wrapper has no dual-surface method')
    );
    native.setSurfaces('#161616', '#161616');
    window.dispatchEvent(new Event('scroll'));
    await waitForFrame();
    flushFrame();
    await waitForLegacySurface('#161616');
    expect(native.calls.style).toEqual(['DARK']);
    expect(native.statusBar.setBackgroundColor).toHaveBeenCalledTimes(1);

    native.setSurfaces('#ffffff', '#161616');
    const routeMarker = document.createElement('main');
    routeMarkers.push(routeMarker);
    document.body.appendChild(routeMarker);
    await waitForFrame();
    flushFrame();
    await waitForSystemSurfaces('#ffffff', '#161616');
    expect(native.calls.style).toEqual(['DARK', 'LIGHT']);
    expect(native.calls.systemBarSurfaces).toHaveLength(2);
    expect(native.calls.systemBarSurfaces[1]).toEqual({
      topColor: '#ffffff',
      bottomColor: '#161616',
      bottomIconStyle: 'light',
    });

    cleanup();
    expect(mediaListeners.size).toBe(0);
    const ignoredMarker = document.createElement('main');
    routeMarkers.push(ignoredMarker);
    document.body.appendChild(ignoredMarker);
    window.dispatchEvent(new Event('scroll'));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(frames.size).toBe(0);
  });
});
