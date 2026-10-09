import { Dialog } from '@base-ui-components/react/dialog';
import { XIcon } from '@phosphor-icons/react';
import { useRef, type ReactNode, type RefObject } from 'react';
import { ButtonAtom } from '../components/Button/Button.atom';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { useOverlayContainer } from './overlayContainer.context';
import styles from './AppSheet.module.css';

// AppSheet — full-height side sheet for "details of one record" (admin user,
// log entry, ...): more room for data than the centered AppDialog card, and a
// native swipe toward its edge closes it.
//
// DECISION (nie usuwaj tego komentarza):
//  • Built on Base UI Dialog (focus trap, ESC, backdrop dismiss, scroll lock,
//    aria-modal) — the same engine as AppDialog, only the geometry differs.
//  • Default side = LEFT (owner, 2026-09-22: „drawer wysuwany od lewej").
//  • Swipe-to-dismiss via the shared useSwipeDismiss, attached from a child of
//    the Popup so the listeners bind when the panel exists (see the hook).
//  • No single-sided border on the free edge (anti-slop floor): the scrim
//    separates the sheet from the page and only the inner corners are rounded.

export type AppSheetSide = 'left' | 'right';
export type AppSheetSize = 'default' | 'wide';

interface AppSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading of the sheet — also its accessible name. */
  title: string;
  /** Optional line under the title (Dialog.Description). */
  description?: string;
  /** Accessible label of the close button (i18n owned by the caller). */
  closeLabel: string;
  side?: AppSheetSide;
  size?: AppSheetSize;
  /** Extra header content next to the title (status pills, actions). */
  headerExtra?: ReactNode;
  /** Sticky footer (primary actions). */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

function SheetSwipe({
  popupRef,
  backdropRef,
  side,
  onDismiss,
}: {
  popupRef: RefObject<HTMLDivElement | null>;
  backdropRef: RefObject<HTMLDivElement | null>;
  side: AppSheetSide;
  onDismiss: () => void;
}) {
  useSwipeDismiss({
    targetRef: popupRef,
    backdropRef,
    direction: side,
    onDismiss,
  });
  return null;
}

export function AppSheetAtom({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  side = 'left',
  size = 'default',
  headerExtra,
  footer,
  className,
  children,
}: AppSheetProps) {
  // Same portal target rule as AppDialog (DECISION in overlayContainer.context:
  // pass `undefined`, never `null`, when there is no phone-frame container).
  const container = useOverlayContainer();
  const popupRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const close = () => onOpenChange(false);
  const popupClass = [styles.sheet, className].filter(Boolean).join(' ');

  return (
    <Dialog.Root open={open} onOpenChange={next => onOpenChange(next)}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Backdrop ref={backdropRef} className={styles.backdrop} />
        {/* Initial focus on the title (WAI-ARIA dialog with content): screen
            readers announce the record, no focus ring lands on "×" (it read as
            a highlighted action) and Tab moves on to the controls. */}
        <Dialog.Popup
          ref={popupRef}
          initialFocus={titleRef}
          className={popupClass}
          data-side={side}
          data-size={size}>
          <SheetSwipe
            popupRef={popupRef}
            backdropRef={backdropRef}
            side={side}
            onDismiss={close}
          />
          <header className={styles.header}>
            <div className={styles.headingBlock}>
              <Dialog.Title
                ref={titleRef}
                tabIndex={-1}
                className={styles.title}>
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className={styles.description}>
                  {description}
                </Dialog.Description>
              )}
            </div>
            {headerExtra != null && (
              <div className={styles.headerExtra}>{headerExtra}</div>
            )}
            <ButtonAtom
              variant='ghost'
              size='sm'
              className={styles.closeButton}
              icon={<XIcon size={20} weight='regular' />}
              ariaLabel={closeLabel}
              onClick={close}
            />
          </header>
          <div className={styles.body}>{children}</div>
          {footer != null && (
            <footer className={styles.footer}>{footer}</footer>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
