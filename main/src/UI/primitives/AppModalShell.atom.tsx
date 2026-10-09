// UI/primitives/AppModalShell.atom.tsx
// Jeden punkt prawdy dla hand-rolled modali (te POZA Base UI `AppDialogAtom`).
// Owija boilerplate, który spowodował klasę bugów „aria-modal bez focus-trapu"
// (r40): focus-trap + role/aria-modal/aria-labelledby/tabIndex + opcjonalny
// scroll-lock + opcjonalny portal + opcjonalny scrim (klik-poza-zamyka).
//
// Każdy konsument WNOSI własne CSS (className) i treść (children) — shell NIE
// ujednolica wyglądu, tylko kontrakt a11y. Dwa warianty struktury:
//   • 'fullscreen' — pojedynczy pełnoekranowy panel (overlay = scrim).
//   • 'backdrop'   — osobny scrim (role='presentation', klik-poza→onClose przez
//                    target===currentTarget; klawiatura zamyka ESC-em focus-trapa,
//                    więc scrim NIE potrzebuje keyboard-handlera ani stopPropagation).
//
// Strażnik `aria-modal-focus-trap` dopuszcza literał `aria-modal='true'` TYLKO tu
// (oraz w plikach z `aria-modal-focus-trap-allow:` — drawer/inline-alert outliery).
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
  /** Struktura ramki — patrz nagłówek pliku. */
  variant: 'fullscreen' | 'backdrop';
  /**
   * Czy focus-trap (i scroll-lock) jest aktywny. Domyślnie `true` — dla rodziców,
   * którzy montują shell DOPIERO gdy otwarty. Konsument trzymany-stale (animacja
   * wejścia/wyjścia przez klasę CSS) przekazuje `active={isOpen}`.
   */
  active?: boolean;
  /**
   * ESC oraz klik-poza-panel (wariant 'backdrop') → zamknięcie. Pomiń, gdy modal
   * nie ma akcji „zamknij" (np. celebracja z 3 wyjściami naprzód).
   */
  onClose?: (() => void) | undefined;
  /** `dialog` (domyślnie) lub `alertdialog` (destrukcyjny confirm). */
  role?: 'dialog' | 'alertdialog';
  /** aria-label (użyj TEGO albo `labelledById`). */
  label?: string;
  /** id nagłówka (aria-labelledby). */
  labelledById?: string;
  /** id opisu (aria-describedby) — opcjonalne. */
  describedById?: string;
  /** Strategia focusu na otwarciu. Domyślnie 'first'. */
  initialFocus?: FocusTrapInitialFocus;
  /** Inertowanie tła. Domyślnie `true`; dla portalu do body użyj `'app-root'`. */
  inert?: boolean | 'app-root';
  /** Kotwica chodzenia inert (gdy panel ma interaktywne rodzeństwo). */
  inertRef?: RefObject<HTMLElement | null>;
  /** Blokada scrolla body, gdy aktywny. */
  scrollLock?: boolean;
  /** Render do `document.body` (użyj z `inert='app-root'`). */
  portal?: boolean;
  /** className fokusowalnego panelu (element z role/aria-modal). */
  className?: string;
  /** className scrimu (tylko wariant 'backdrop'). */
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

  // inertRef pominięty gdy brak (exactOptionalPropertyTypes: nie przekazujemy
  // jawnego `undefined` do opcjonalnego propa hooka).
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
      className={className}
      role={role}
      aria-modal='true'
      aria-label={label}
      aria-labelledby={labelledById}
      aria-describedby={describedById}
      tabIndex={-1}>
      {children}
    </div>
  );

  // Wariant 'backdrop': scrim jako role='presentation'. Klik-poza-panel zamyka
  // przez sprawdzenie target===currentTarget (klik w panel NIE zamyka, bez
  // stopPropagation). Klawiatura: ESC obsługuje focus-trap, więc scrim nie ma
  // (i nie potrzebuje) keyboard-handlera — eslint a11y czysty dla role='presentation'.
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
