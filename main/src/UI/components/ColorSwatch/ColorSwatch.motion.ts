import { useEffect, useLayoutEffect, useRef } from 'react';

// WAAPI replaces the current animation instead of queueing taps.
// The selected prop is authoritative; mounting never animates a saved choice.
export function useSwatchMotion(selected: boolean, disabled: boolean) {
  const ref = useRef<HTMLButtonElement & HTMLSpanElement>(null);
  const previous = useRef(selected);
  const animations = useRef<Animation[]>([]);
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) {
      return;
    }
    const dot = el.firstElementChild;
    if (!dot) {
      return;
    }
    const play = (frames: Keyframe[], duration: number, hold = false) => {
      animations.current.forEach(animation => animation.cancel());
      animations.current = [
        dot.animate(frames, {
          duration,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          fill: hold ? 'forwards' : 'none',
        }),
      ];
    };
    let pressedSelection = previous.current;
    const down = () => {
      pressedSelection = previous.current;
      play(
        [
          { transform: getComputedStyle(dot).transform },
          { transform: 'scale(.94)' },
        ],
        120,
        true
      );
    };
    const up = () => {
      // Enter selects on keydown; its keyup must not cancel the select settle.
      if (pressedSelection !== previous.current) {
        return;
      }
      play(
        [
          { transform: getComputedStyle(dot).transform },
          { transform: 'scale(1)' },
        ],
        160
      );
    };
    const keyDown = (event: KeyboardEvent) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
        down();
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') {
        up();
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('blur', up);
    el.addEventListener('keydown', keyDown);
    el.addEventListener('keyup', keyUp);
    return () => {
      animations.current.forEach(animation => animation.cancel());
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('blur', up);
      el.removeEventListener('keydown', keyDown);
      el.removeEventListener('keyup', keyUp);
    };
  }, [disabled]);
  useLayoutEffect(() => {
    const changed = previous.current !== selected;
    previous.current = selected;
    const el = ref.current;
    if (!changed || !el || disabled) {
      return;
    }
    const dot = el.firstElementChild;
    const mark = el.querySelector('[data-motion-mark]');
    const wave = el.querySelector('[data-motion-wave]');
    if (!dot) {
      return;
    }
    const startTransform = getComputedStyle(dot).transform;
    const interrupted = mark
      ?.getAnimations?.()
      .some(
        animation =>
          (animation.playState === 'running' ||
            animation.playState === 'paused') &&
          Number(animation.currentTime ?? 0) <
            Number(animation.effect?.getComputedTiming().endTime ?? Infinity)
      );
    const startOpacity =
      mark && interrupted
        ? getComputedStyle(mark).opacity
        : selected
          ? '0'
          : '1';
    animations.current.forEach(animation => animation.cancel());
    animations.current = [
      dot.animate(
        (selected ? [1, 1.025, 1] : [1, 0.9, 1]).map((scale, index) => ({
          transform: index === 0 ? startTransform : `scale(${scale})`,
        })),
        {
          duration: 200,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        }
      ),
    ];
    if (mark) {
      animations.current.push(
        mark.animate(
          selected
            ? [
                {
                  opacity: startOpacity,
                  transform: 'scale(.9)',
                },
                { opacity: 1, transform: 'scale(1)' },
              ]
            : [
                { opacity: startOpacity, transform: 'scale(1)' },
                { opacity: 0, transform: 'scale(.75)' },
              ],
          { duration: 200 }
        )
      );
    }
    if (wave) {
      animations.current.push(
        wave.animate(
          [
            { opacity: 0.35, transform: 'scale(.1)' },
            { opacity: 0, transform: 'scale(1)' },
          ],
          { duration: 260 }
        )
      );
    }
  }, [selected, disabled]);
  return ref;
}
