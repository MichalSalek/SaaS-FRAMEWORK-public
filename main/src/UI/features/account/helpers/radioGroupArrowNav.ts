// UI/features/account/helpers/radioGroupArrowNav.ts
// Roving tabindex dla WAI-ARIA radiogroup zbudowanego z <button role='radio'>:
// 1 tab-stop (zaznaczony swatch), strzałka przenosi fokus I WYBÓR (APG:
// selection follows focus w radio group — sam fokus zostawiał aria-checked na
// starym swatchu, review S51). Czysta funkcja DOM, bez stanu React.

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
