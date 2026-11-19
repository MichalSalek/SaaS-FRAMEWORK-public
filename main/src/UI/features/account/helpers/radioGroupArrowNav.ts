// UI/features/account/helpers/radioGroupArrowNav.ts
// Roving tabindex for a WAI-ARIA radiogroup built from <button role='radio'>: one tab stop (the
// selected swatch); an arrow moves focus AND selection (APG: selection follows focus in a radio
// group; focus alone left aria-checked on the old swatch). Pure DOM function, no React state.

import type { KeyboardEvent } from 'react';

const ARROW_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
const FORWARD_KEYS = ['ArrowRight', 'ArrowDown'];

export function handleRadioArrowNav(e: KeyboardEvent<HTMLButtonElement>): void {
  if (!ARROW_KEYS.includes(e.key)) {
    return;
  }
  e.preventDefault();
  const group = e.currentTarget.closest('[role="radiogroup"]');
  if (!group) {
    return;
  }
  const radios = Array.from(
    group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  ).filter(r => !r.disabled);
  const current = radios.indexOf(e.currentTarget);
  if (current === -1) {
    return;
  }
  const forward = FORWARD_KEYS.includes(e.key);
  const next =
    radios[(current + (forward ? 1 : radios.length - 1)) % radios.length];
  next?.focus();
  next?.click();
}
