import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeMailHeight } from './AdminEmailPreviewPage.height';

describe('email preview document height', () => {
  const onHeight = vi.fn<(height: number) => void>();
  const observerCallbacks: Array<() => void> = [];
  const disconnect = vi.fn();
  const parentObserver = vi.fn(
    class {
      constructor(callback: () => void) {
        observerCallbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    }
  );
  const scheduled = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let frame: HTMLIFrameElement;
  let root: HTMLElement;
  let measuredHeight = 400;

  function flushFrame() {
    const callbacks = [...scheduled.values()];
    scheduled.clear();
    for (const callback of callbacks) {
      callback(0);
    }
  }

  beforeEach(() => {
    nextFrame = 0;
    measuredHeight = 400;
    observerCallbacks.length = 0;
    scheduled.clear();
    onHeight.mockClear();
    disconnect.mockClear();
    parentObserver.mockClear();
    vi.stubGlobal('ResizeObserver', parentObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame += 1;
      scheduled.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => scheduled.delete(id));

    frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const documentRoot = frame.contentDocument?.documentElement;
    if (!documentRoot) {
      throw new Error('Brak dokumentu ramki testowej');
    }
    root = documentRoot;
    Object.defineProperty(root.ownerDocument.defaultView, 'ResizeObserver', {
      configurable: true,
      value: class {
        constructor(callback: () => void) {
          observerCallbacks.push(callback);
        }
        observe() {}
        disconnect = disconnect;
      },
    });
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({
      height: measuredHeight,
      width: 500,
      top: 0,
      left: 0,
      right: 500,
      bottom: measuredHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => {
    frame.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defers and coalesces observer delivery before changing frame height', () => {
    const stop = observeMailHeight(frame, onHeight);
    observerCallbacks[0]?.();
    observerCallbacks[0]?.();
    expect(onHeight).not.toHaveBeenCalled();
    expect(scheduled.size).toBe(1);

    flushFrame();
    expect(onHeight).toHaveBeenCalledExactlyOnceWith(400);
    expect(parentObserver).not.toHaveBeenCalled();
    stop();
  });

  it('publishes a changed intrinsic height and skips identical measurements', () => {
    const stop = observeMailHeight(frame, onHeight);
    flushFrame();
    observerCallbacks[0]?.();
    flushFrame();
    expect(onHeight).toHaveBeenCalledTimes(1);

    measuredHeight = 550.2;
    observerCallbacks[0]?.();
    flushFrame();
    expect(onHeight).toHaveBeenLastCalledWith(551);
    expect(onHeight).toHaveBeenCalledTimes(2);
    stop();
  });

  it('cancels pending work from the previous template or an unmounted frame', () => {
    const stop = observeMailHeight(frame, onHeight);
    const staleCallback = [...scheduled.values()][0];
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(scheduled.size).toBe(0);

    observerCallbacks[0]?.();
    staleCallback?.(0);
    expect(onHeight).not.toHaveBeenCalled();
    expect(scheduled.size).toBe(0);
  });
});
