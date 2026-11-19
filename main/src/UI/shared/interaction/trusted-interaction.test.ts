import { describe, it, expect, vi } from 'vitest';

describe('trusted input boundary', () => {
  it('ignores synthetic click/focus/scroll', async () => {
    vi.resetModules();
    const { onTrustedInteraction, hasTrustedInteraction } =
      await import('./trusted-interaction');
    const callback = vi.fn();
    const remove = onTrustedInteraction(callback);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.click();
    window.dispatchEvent(new Event('scroll'));
    button.focus();
    expect(hasTrustedInteraction()).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    remove();
    button.remove();
  });

  it('arms capture listeners for keyboard input', async () => {
    vi.resetModules();
    const add = vi.spyOn(window, 'addEventListener');
    const { onTrustedInteraction } = await import('./trusted-interaction');
    const unsubscribe = onTrustedInteraction(vi.fn());
    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function), {
      passive: true,
      capture: true,
    });
    unsubscribe();
    add.mockRestore();
  });
});
