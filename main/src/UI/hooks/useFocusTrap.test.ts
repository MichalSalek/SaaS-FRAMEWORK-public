import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

// jsdom lays nothing out, so mark the buttons as rendered for the visible-only
// focusable filter the trap applies (it exists for hidden Stripe iframes).
function laidOutButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  button.getClientRects = () =>
    ({ length: 1, item: () => null }) as unknown as DOMRectList;
  return button;
}

function tab(shiftKey: boolean): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })
  );
}

describe('useFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps Shift+Tab inside when focus sits on the container itself', () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    const first = laidOutButton('first');
    const last = laidOutButton('last');
    container.append(first, last);
    document.body.append(container);

    const ref = { current: container };
    const { unmount } = renderHook(() =>
      useFocusTrap(ref, { active: true, initialFocus: 'container' })
    );
    container.focus();
    tab(true);
    expect(document.activeElement).toBe(last);

    container.focus();
    tab(false);
    expect(document.activeElement).toBe(first);
    unmount();
  });

  it('wraps from the last element to the first', () => {
    const container = document.createElement('div');
    const first = laidOutButton('first');
    const last = laidOutButton('last');
    container.append(first, last);
    document.body.append(container);

    const ref = { current: container };
    const { unmount } = renderHook(() =>
      useFocusTrap(ref, { active: true, initialFocus: 'first' })
    );
    last.focus();
    tab(false);
    expect(document.activeElement).toBe(first);
    unmount();
  });
});
