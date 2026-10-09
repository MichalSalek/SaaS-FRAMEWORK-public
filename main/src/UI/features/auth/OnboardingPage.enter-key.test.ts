import { describe, it, expect, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { advanceOnEnterKey } from './OnboardingPage.parts.helpers';

const buildForm = () => {
  const form = document.createElement('form');
  form.innerHTML = `
    <input name="display_name" type="text" />
    <input name="consent" type="checkbox" />
    <input name="address_city" type="text" />
    <input name="phone" type="text" inputmode="tel" />`;
  document.body.appendChild(form);
  const field = (name: string) =>
    form.querySelector<HTMLInputElement>(
      `[name="${name}"]`
    ) as HTMLInputElement;
  return { form, field };
};

const keyEvent = (
  form: HTMLFormElement,
  target: EventTarget,
  key = 'Enter'
) => {
  const preventDefault = vi.fn();
  const event = {
    key,
    target,
    currentTarget: form,
    preventDefault,
    nativeEvent: { isComposing: false },
  } as unknown as KeyboardEvent<HTMLFormElement>;
  return { event, preventDefault };
};

describe('advanceOnEnterKey', () => {
  it('moves focus to the next text field, skipping checkboxes', () => {
    const { form, field } = buildForm();
    const onAdvance = vi.fn();
    const { event, preventDefault } = keyEvent(form, field('display_name'));
    advanceOnEnterKey(event, onAdvance);
    expect(document.activeElement).toBe(field('address_city'));
    expect(preventDefault).toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('advances the step from the last text field', () => {
    const { form, field } = buildForm();
    const onAdvance = vi.fn();
    advanceOnEnterKey(keyEvent(form, field('phone')).event, onAdvance);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys and non-text targets', () => {
    const { form, field } = buildForm();
    const onAdvance = vi.fn();
    const other = keyEvent(form, field('phone'), 'Tab');
    advanceOnEnterKey(other.event, onAdvance);
    const checkbox = keyEvent(form, field('consent'));
    advanceOnEnterKey(checkbox.event, onAdvance);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(checkbox.preventDefault).not.toHaveBeenCalled();
  });
});
