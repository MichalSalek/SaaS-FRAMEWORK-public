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
   * DECISION: the call site states the direction and the primitive owns the glyph and its side:
   * when the arrow was an `icon` plus a side prop, eight forward CTAs forgot the prop and rendered
   * the arrow BEFORE the label. Guard `audit:forward-arrow-ownership`. `icon` stays the leading
   * slot (a spinner, a plus), so a busy forward button still works. (owner)
   */
  direction?: ButtonDirection | undefined;
  children?: ReactNode;
  className?: string;
  /** Accessible label — required for icon-only buttons (no children). */
  ariaLabel?: string;
  /**
   * One-shot horizontal error shake (validation/rejection feedback). The parent sets it to
   * `true` on an error and resets it in `onShakeEnd`. Reusable on EVERY submit button
   * (newsletter, contact, login, checkout...).
   */
  shake?: boolean;
  /** Called when the shake animation ends: reset `shake` to false here. */
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
      // DECISION: `type` defaults to 'button' because HTML defaults to 'submit': without it every
      // <ButtonAtom> inside a <form> submitted that form. All real submitting buttons declare
      // type='submit' explicitly, and `...rest` comes AFTER this line so a caller's explicit `type`
      // still wins.
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
