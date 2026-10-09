import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { mswServer } from './src/test-utils/msw/server';

// ── MSW lifecycle ─────────────────────────────────────────────────────────
// Contract tests (W0.3) drive the real data-layer against mocked HTTP.
// `onUnhandledRequest: 'error'` makes a missing handler a loud failure, not a
// silent network hang — surfaces enabled-gating regressions (a query that
// should NOT fire will throw here if it does).
beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  cleanup();
});
afterAll(() => mswServer.close());

// ── jsdom polyfills ─────────────────────────────────────────────────────────
// ThemeProvider reads window.matchMedia on mount (prefers-color-scheme).
// jsdom does not implement it → provide a non-matching stub.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(), // deprecated, kept for safety
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// IntersectionObserver — used by infinite-scroll triggers and lazy mounts.
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  // @ts-expect-error — minimal stub for jsdom
  window.IntersectionObserver = IO;
}

// scrollTo — jsdom no-op (layout hooks call it on route change).
if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = vi.fn();
}
