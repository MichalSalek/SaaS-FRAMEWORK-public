import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  brightness: -1,
  available: true,
  platform: 'android',
  setBrightness: vi.fn(async ({ brightness }: { brightness: number }) => {
    native.brightness = brightness;
  }),
  getBrightness: vi.fn(async () => ({ brightness: native.brightness })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => native.available,
    getPlatform: () => native.platform,
  },
  registerPlugin: () => native,
}));

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  native.brightness = -1;
  native.available = true;
  native.platform = 'android';
  vi.clearAllMocks();
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  // Drain the lifecycle cleanup before the next document/module is created.
  await vi.waitFor(() => expect(native.brightness).not.toBe(1));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('screen brightness ownership', () => {
  it.each(['first', 'second'])(
    'restores system brightness after overlapping views close (%s closes first)',
    async firstToClose => {
      const { requestMaxBrightness } = await import('./screen-brightness');
      const first = await requestMaxBrightness();
      const second = await requestMaxBrightness();
      expect(native.brightness).toBe(1);

      const [earlier, later] =
        firstToClose === 'first' ? [first, second] : [second, first];
      await earlier.release();
      expect(native.brightness).toBe(1);
      await later.release();
      expect(native.brightness).toBe(-1);

      // Re-entering QR must not turn an orphaned maximum into the new baseline.
      const reopened = await requestMaxBrightness();
      await reopened.release();
      expect(native.brightness).toBe(-1);
    }
  );

  it('restores after concurrent acquisitions and ignores repeated release', async () => {
    const { requestMaxBrightness } = await import('./screen-brightness');
    const [first, second] = await Promise.all([
      requestMaxBrightness(),
      requestMaxBrightness(),
    ]);
    await first.release();
    await first.release();
    expect(native.brightness).toBe(1);
    await second.release();
    expect(native.brightness).toBe(-1);
  });

  it('serializes a slow restore before the next view acquires brightness', async () => {
    const { requestMaxBrightness } = await import('./screen-brightness');
    const first = await requestMaxBrightness();
    const restore = Promise.withResolvers<void>();
    native.setBrightness.mockImplementationOnce(async ({ brightness }) => {
      await restore.promise;
      native.brightness = brightness;
    });
    const releasing = first.release();
    await vi.waitFor(() =>
      expect(native.setBrightness).toHaveBeenLastCalledWith({ brightness: -1 })
    );
    const acquiring = requestMaxBrightness();
    restore.resolve();
    await releasing;
    const second = await acquiring;
    expect(native.brightness).toBe(1);
    await second.release();
    expect(native.brightness).toBe(-1);
  });

  it('repairs an Android override after document replacement without reopening QR', async () => {
    const firstDocument = await import('./screen-brightness');
    await firstDocument.requestMaxBrightness();
    expect(native.brightness).toBe(1);

    // OAuth replaces JS, but keeps the same Android window. Old cleanup never ran.
    vi.resetModules();
    const nextDocument = await import('./screen-brightness');
    dispose = nextDocument.initScreenBrightness();
    await vi.waitFor(() => expect(native.brightness).toBe(-1));
  });

  it('lets a child view acquire before lifecycle initialization without losing its lease', async () => {
    native.brightness = 1;
    const { requestMaxBrightness, initScreenBrightness } =
      await import('./screen-brightness');
    const acquiring = requestMaxBrightness();
    dispose = initScreenBrightness();
    const view = await acquiring;
    expect(native.brightness).toBe(1);
    await view.release();
    expect(native.brightness).toBe(-1);
  });

  it('suspends on pagehide, resumes a cached QR page, and stays dim after leaving it', async () => {
    const { requestMaxBrightness, initScreenBrightness } =
      await import('./screen-brightness');
    dispose = initScreenBrightness();
    const view = await requestMaxBrightness();
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(native.brightness).toBe(-1));
    window.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(native.brightness).toBe(1));
    await view.release();
    window.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(native.brightness).toBe(-1));
  });

  it('releases wake lock and brightness in background, and reacquires only for a live view', async () => {
    const locks: { released: boolean; release: ReturnType<typeof vi.fn> }[] =
      [];
    const request = vi.fn(async () => {
      const lock = {
        released: false,
        release: vi.fn(async () => {
          lock.released = true;
        }),
      };
      locks.push(lock);
      return lock;
    });
    vi.stubGlobal('navigator', { wakeLock: { request } });
    let visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility as DocumentVisibilityState
    );
    const { requestMaxBrightness, initScreenBrightness } =
      await import('./screen-brightness');
    dispose = initScreenBrightness();
    const view = await requestMaxBrightness();
    expect(request).toHaveBeenCalledTimes(1);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(native.brightness).toBe(-1));
    expect(locks[0].release).toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(native.brightness).toBe(1));
    expect(request).toHaveBeenCalledTimes(2);
    await view.release();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(native.brightness).toBe(-1));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries failed restoration on the next lifecycle event', async () => {
    const { requestMaxBrightness, initScreenBrightness } =
      await import('./screen-brightness');
    dispose = initScreenBrightness();
    const view = await requestMaxBrightness();
    native.setBrightness.mockRejectedValueOnce(
      new Error('bridge temporarily unavailable')
    );
    await view.release();
    expect(native.brightness).toBe(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(native.brightness).toBe(-1));
  });

  it('preserves the original brightness on iOS', async () => {
    native.platform = 'ios';
    native.brightness = 0.35;
    const { requestMaxBrightness } = await import('./screen-brightness');
    const view = await requestMaxBrightness();
    expect(native.brightness).toBe(1);
    await view.release();
    expect(native.brightness).toBe(0.35);
  });

  it('works with a denied wake lock and no native plugin', async () => {
    native.available = false;
    vi.stubGlobal('navigator', {
      wakeLock: { request: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const { requestMaxBrightness } = await import('./screen-brightness');
    const view = await requestMaxBrightness();
    await expect(view.release()).resolves.toBeUndefined();
    expect(native.setBrightness).not.toHaveBeenCalled();
  });
});
