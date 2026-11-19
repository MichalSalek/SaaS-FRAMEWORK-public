import { describe, expect, it } from 'vitest';
import { consumeNativeBack, NATIVE_BACK_EVENT } from './native-back';

describe('native hardware Back', () => {
  it('leaves ordinary navigation unhandled', () => {
    expect(consumeNativeBack()).toBe(false);
  });

  it('lets an open overlay close without navigating behind it', () => {
    let closed = false;
    const listener = (event: Event) => {
      closed = true;
      event.preventDefault();
    };
    window.addEventListener(NATIVE_BACK_EVENT, listener);
    try {
      expect(consumeNativeBack()).toBe(true);
      expect(closed).toBe(true);
    } finally {
      window.removeEventListener(NATIVE_BACK_EVENT, listener);
    }
    expect(consumeNativeBack()).toBe(false);
  });
});
