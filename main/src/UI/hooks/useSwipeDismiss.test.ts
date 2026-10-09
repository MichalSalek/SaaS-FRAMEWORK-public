// Gesture core of useSwipeDismiss: a completed swipe must reach the caller's
// close channel. AppDialog closes by clicking a hidden Dialog.Close from
// `onDismiss`, so that click must not be eaten by the post-drag click trap.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachSwipeDismiss } from './useSwipeDismiss';

vi.mock('../../application/platform/haptics', () => ({
  hapticImpact: () => Promise.resolve(),
}));

function pointer(
  type: string,
  init: { x: number; y: number; timeStamp?: number }
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x,
    clientY: init.y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  if (init.timeStamp !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: init.timeStamp });
  }
  return event;
}

function swipeDown(handle: HTMLElement, distance: number): void {
  handle.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
  handle.dispatchEvent(
    pointer('pointermove', { x: 10, y: 30, timeStamp: 1000 })
  );
  handle.dispatchEvent(
    pointer('pointermove', { x: 10, y: 10 + distance, timeStamp: 1400 })
  );
  handle.dispatchEvent(
    pointer('pointerup', { x: 10, y: 10 + distance, timeStamp: 1450 })
  );
}

describe('attachSwipeDismiss', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lets the click issued from onDismiss reach its target', () => {
    const target = document.createElement('div');
    const closeButton = document.createElement('button');
    const onClose = vi.fn();
    closeButton.addEventListener('click', onClose);
    document.body.append(target, closeButton);

    const detach = attachSwipeDismiss(target, target, null, 'down', false, {
      onDismiss: () => closeButton.click(),
    });
    swipeDown(target, 200);
    detach();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still swallows the click the touch synthesises after the drag', () => {
    const target = document.createElement('div');
    const underFinger = document.createElement('button');
    const onTap = vi.fn();
    underFinger.addEventListener('click', onTap);
    document.body.append(target, underFinger);

    const onDismiss = vi.fn();
    const detach = attachSwipeDismiss(target, target, null, 'down', false, {
      onDismiss,
    });
    swipeDown(target, 200);
    underFinger.click();
    detach();

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('springs back without dismissing on a short drag', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onDismiss = vi.fn();
    const detach = attachSwipeDismiss(target, target, null, 'down', false, {
      onDismiss,
    });
    handleShortDrag(target);
    detach();

    expect(onDismiss).not.toHaveBeenCalled();
    expect(target.style.transform).toBe('');
  });

  it('clears the off-screen inline styles even when detached mid-settle', () => {
    vi.useFakeTimers();
    try {
      // A persistent drawer: dismissing flips `enabled`, which detaches the
      // gesture inside the settle window. The panel must not stay parked
      // off-screen for the next open.
      const target = document.createElement('div');
      const backdrop = document.createElement('div');
      document.body.append(backdrop, target);
      const detach = attachSwipeDismiss(
        target,
        target,
        backdrop,
        'down',
        false,
        { onDismiss: () => undefined }
      );
      swipeDown(target, 200);
      expect(target.style.transform).not.toBe('');
      // React runs the effect cleanup after the re-render: settle is pending.
      detach();

      vi.runAllTimers();

      expect(target.style.transform).toBe('');
      expect(backdrop.style.opacity).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

function handleShortDrag(handle: HTMLElement): void {
  handle.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
  handle.dispatchEvent(
    pointer('pointermove', { x: 10, y: 22, timeStamp: 1000 })
  );
  handle.dispatchEvent(
    pointer('pointermove', { x: 10, y: 30, timeStamp: 2000 })
  );
  handle.dispatchEvent(pointer('pointerup', { x: 10, y: 30, timeStamp: 2100 }));
}
