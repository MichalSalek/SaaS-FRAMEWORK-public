import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSwatchMotion } from './ColorSwatch.motion';

function Harness({
  selected = false,
  disabled = false,
}: {
  selected?: boolean;
  disabled?: boolean;
}) {
  const ref = useSwatchMotion(selected, disabled);
  return (
    <button ref={ref} disabled={disabled}>
      <span />
      <span data-motion-mark />
      <span data-motion-wave />
    </button>
  );
}

const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalAnimate) {
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  } else {
    Reflect.deleteProperty(Element.prototype, 'animate');
  }
});
function animationSpy() {
  const cancel = vi.fn();
  const animate = vi.fn(
    (_frames: Keyframe[], _options: KeyframeAnimationOptions) =>
      ({ cancel }) as unknown as Animation
  );
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  return { animate, cancel };
}

describe('swatch motion lifecycle', () => {
  it('does not animate a saved selection on mount', () => {
    const { animate } = animationSpy();
    render(<Harness selected />);
    expect(animate).not.toHaveBeenCalled();
  });
  it('replaces animations on rapid toggles and cancels them when disabled', () => {
    const { animate, cancel } = animationSpy();
    const { rerender } = render(<Harness />);
    fireEvent.pointerDown(screen.getByRole('button'));
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Harness selected />);
    expect(cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(4);
    rerender(<Harness selected={false} />);
    expect(animate).toHaveBeenCalledTimes(7);
    expect(animate.mock.calls.at(-2)?.[0]).toEqual([
      { opacity: '1', transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(.75)' },
    ]);
    rerender(<Harness disabled />);
    const count = animate.mock.calls.length;
    fireEvent.pointerDown(screen.getByRole('button'));
    expect(animate).toHaveBeenCalledTimes(count);
  });
  it('keeps the Enter select animation on keyup and supports Space release', () => {
    const { animate } = animationSpy();
    const { rerender } = render(<Harness />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    rerender(<Harness selected />);
    const count = animate.mock.calls.length;
    fireEvent.keyUp(screen.getByRole('button'), { key: 'Enter' });
    expect(animate).toHaveBeenCalledTimes(count);
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    fireEvent.keyUp(screen.getByRole('button'), { key: ' ' });
    expect(animate).toHaveBeenCalledTimes(count + 2);
  });
});
