import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { buttonClassName, ButtonInner } from './buttonCore';

export type ButtonVariant =
  'primary' | 'outlined' | 'text' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonDirection = 'forward';

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading slot, before the label (a plus, a spinner). There is no trailing
   *  slot: the only glyph after a label is the forward arrow (`direction`). */
  icon?: ReactNode;
  /**
   * `'forward'` = a CTA that moves the person on („Dalej”, „Przejdź”,
   * „Zobacz”). The primitive draws the arrow itself, always AFTER the label.
   *
   * DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-10-08:
   * the arrow used to be an `icon` the call-site had to pair with a second
   * prop saying which side; eight forward CTAs forgot it and rendered the
   * arrow BEFORE the label („→ Zatwierdź”). A call-site can no longer place a
   * forward arrow at all: it states the direction and the primitive owns the
   * glyph and its side (the side prop is gone; guard
   * `audit:forward-arrow-ownership`). `icon` stays the leading slot (a
   * spinner, a plus), so a busy forward button still works.
   */
  direction?: ButtonDirection | undefined;
  children?: ReactNode;
  className?: string;
  /** Accessible label — required for icon-only buttons (no children). */
  ariaLabel?: string;
  /**
   * One-shot poziomy error-shake (feedback walidacji/odrzucenia). Parent
   * podnosi na `true` przy błędzie i zeruje w `onShakeEnd`. Reużywalny na
   * KAŻDYM przycisku submit (newsletter, kontakt, logowanie, checkout...).
   */
  shake?: boolean;
  /** Wywoływane po zakończeniu animacji shake — tu zresetuj `shake` na false. */
  onShakeEnd?: () => void;
  /**
   * The action is in flight: a spinner shows inside the button, the width does
   * not change, further clicks are ignored and `aria-busy` is set. Use this
   * instead of passing a spinner through `icon` (DECISION in buttonCore).
   * The button stays enabled-looking; pass `disabled` only for a control that
   * cannot be used at all.
   */
  loading?: boolean | undefined;
}

export function ButtonAtom({
  variant = 'primary',
  size = 'md',
  icon,
  direction,
  children,
  disabled,
  className,
  ariaLabel,
  shake,
  onShakeEnd,
  onAnimationEnd,
  loading = false,
  onClick,
  ...rest
}: ButtonProps) {
  const isIconOnly = icon != null && children == null;

  return (
    <button
      // DECISION (nie usuwaj tego komentarza) — S113, po przeglądzie:
      // Domyślnie `type='button'`, bo HTML domyślnie daje `submit`. Prymityw był bez
      // `type`, więc KAŻDY `<ButtonAtom>` postawiony wewnątrz `<form>` wysyłał ten
      // formularz — 345 użyć, z czego dotąd ratowało nas tylko to, że surowe
      // `<button>` w tym repo jawnie deklarowały `type='button'`. Migracja takiego
      // surowego przycisku na prymityw ten guard po cichu zdejmowała.
      // Sprawdzone przed zmianą: wszystkie realne przyciski wysyłające formularz mają
      // jawne `type='submit'`, więc nic nie polegało na domyślnym zachowaniu.
      // `...rest` jest PO tej linii, więc jawny `type` od wołającego nadal wygrywa.
      type='button'
      className={buttonClassName({
        variant,
        size,
        isIconOnly,
        disabled,
        shake,
        loading,
        className,
      })}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      // In flight the button ignores presses but is NOT `disabled`: a disabled
      // button drops focus and dims, which reads as „this failed”. The default
      // is prevented too: a `type='submit'` button has no handler of its own,
      // its press (and Enter in a field) submits the FORM, so dropping
      // `onClick` alone let a busy submit button send the form a second time.
      onClick={loading ? event => event.preventDefault() : onClick}
      onAnimationEnd={e => {
        onShakeEnd?.();
        onAnimationEnd?.(e);
      }}
      {...rest}>
      <ButtonInner icon={icon} direction={direction} loading={loading}>
        {children}
      </ButtonInner>
    </button>
  );
}
