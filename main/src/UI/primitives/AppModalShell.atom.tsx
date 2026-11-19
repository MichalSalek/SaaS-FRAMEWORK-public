// UI/primitives/AppModalShell.atom.tsx
// Single source of truth for hand-rolled modals (those OUTSIDE Base UI `AppDialogAtom`): focus trap
// + role/aria-modal/aria-labelledby/tabIndex + optional scroll lock, portal and scrim, so no modal
// ships aria-modal without a focus trap. Consumers bring their own CSS and content; the shell
// unifies the a11y contract, not the look. Two variants:
//   - 'fullscreen': a single full-screen panel (overlay = scrim).
//   - 'backdrop':   a separate scrim (role='presentation', click outside -> onClose via
//                   target===currentTarget; ESC is handled by the focus trap, so the scrim needs
//                   no keyboard handler or stopPropagation).
// The `aria-modal-focus-trap` guard allows the literal `aria-modal='true'` ONLY here (and in
// files with `aria-modal-focus-trap-allow:`: drawer/inline-alert outliers).
//
// Stack: React + useFocusTrap/useScrollLock.

import { useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  useFocusTrap,
  type FocusTrapInitialFocus,
} from '../hooks/useFocusTrap';
import { useScrollLock } from '../hooks/useScrollLock';

export interface AppModalShellProps {
  /** Frame structure; see the file header. */
  variant: 'fullscreen' | 'backdrop';
  /**
   * Whether the focus trap (and scroll lock) is active. Default `true`, for parents that mount
   * the shell ONLY while open. A consumer kept mounted (enter/exit animation via a CSS class)
   * passes `active={isOpen}`.
   */
  active?: boolean;
  /**
   * ESC and click outside the panel ('backdrop' variant) close it. Omit when the modal has no
   * "close" action (e.g. a celebration with 3 forward exits).
   */
  onClose?: (() => void) | undefined;
  /** `dialog` (default) or `alertdialog` (destructive confirm). */
  role?: 'dialog' | 'alertdialog';
  /** aria-label (use THIS or `labelledById`). */
  label?: string;
  /** Heading id (aria-labelledby). */
  labelledById?: string;
  /** Description id (aria-describedby), optional. */
  describedById?: string;
  /** Focus strategy on open. Default 'first'. */
  initialFocus?: FocusTrapInitialFocus;
  /** Makes the background inert. Default `true`; for a portal into body use `'app-root'`. */
  inert?: boolean | 'app-root';
  /** Anchor for the inert walk (when the panel has interactive siblings). */
  inertRef?: RefObject<HTMLElement | null>;
  /** Locks body scroll while active. */
  scrollLock?: boolean;
  /** Render into `document.body` (use with `inert='app-root'`). */
  portal?: boolean;
  /** className of the focusable panel (the element with role/aria-modal). */
  className?: string;
  /** className of the scrim ('backdrop' variant only). */
  backdropClassName?: string;
  children: ReactNode;
}

export function AppModalShellAtom({
  variant,
  active = true,
  onClose,
  role = 'dialog',
  label,
  labelledById,
  describedById,
  initialFocus = 'first',
  inert = true,
  inertRef,
  scrollLock = false,
  portal = false,
  className,
  backdropClassName,
  children,
}: AppModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // inertRef is omitted when absent (exactOptionalPropertyTypes: no explicit `undefined`
  // for the hook's optional prop).
  useFocusTrap(panelRef, {
    active,
    onEscape: onClose,
    initialFocus,
    inert,
    ...(inertRef ? { inertRef } : {}),
  });
  useScrollLock(scrollLock && active);

  const panel = (
    <div
      ref={panelRef}
      data-app-section-exclude=''
      className={className}
      role={role}
      // Closed sheets stay mounted for their exit transition. Opacity and transforms do not
      // remove their controls from keyboard navigation or the accessibility tree.
      inert={!active}
      aria-hidden={!active}
      aria-modal={active ? true : undefined}
      aria-label={label}
      aria-labelledby={labelledById}
      aria-describedby={describedById}
      tabIndex={-1}>
      {children}
    </div>
  );

  // 'backdrop' variant: the scrim is role='presentation'. A click outside closes via
  // target===currentTarget (a click in the panel does NOT close, no stopPropagation). ESC is
  // handled by the focus trap, so the scrim needs no keyboard handler (eslint a11y is clean
  // for role='presentation').
  const tree =
    variant === 'backdrop' ? (
      <div
        className={backdropClassName}
        role='presentation'
        onClick={
          onClose
            ? event => {
                if (event.target === event.currentTarget) {
                  onClose();
                }
              }
            : undefined
        }>
        {panel}
      </div>
    ) : (
      panel
    );

  if (portal && typeof document !== 'undefined') {
    return createPortal(tree, document.body);
  }
  return tree;
}
