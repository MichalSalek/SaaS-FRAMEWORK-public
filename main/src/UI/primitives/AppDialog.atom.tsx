import { Dialog } from '@base-ui-components/react/dialog';
import {
  useRef,
  type ReactNode,
  type RefObject,
  type ComponentProps,
} from 'react';
import { useTranslations } from 'next-intl';
import { XIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../components/Button/Button.atom';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { useOverlayContainer } from './overlayContainer.context';
import styles from './AppDialog.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppDialogProps {
  /** Controlled open state */
  open: boolean;
  /** Callback fired when the dialog should open or close */
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  /** Whether the dialog should be modal (default: true) */
  modal?: boolean | 'trap-focus';
  /**
   * Whether the dialog can NOT be dismissed by outside click.
   * When true, only ESC and explicit close buttons work.
   * @default false
   */
  disablePointerDismissal?: boolean;
  children: ReactNode;
}

interface AppDialogContentProps {
  /** Dialog title — required for accessibility */
  title: string;
  /** Optional subtitle / description */
  description?: string;
  /** Prevent dismissal while an irreversible request is in flight. */
  closeDisabled?: boolean;
  /** The confirmed result may live outside the scrolled list that opened the dialog. */
  finalFocus?: ComponentProps<typeof Dialog.Popup>['finalFocus'];
  /** Extra CSS class for the popup container */
  className?: string;
  children: ReactNode;
}

interface AppDialogActionsProps {
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Root — wraps Dialog.Root with sensible defaults
// ---------------------------------------------------------------------------

function AppDialogRoot({
  open,
  onOpenChange,
  onOpenChangeComplete,
  modal = true,
  disablePointerDismissal = false,
  children,
}: AppDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={nextOpen => onOpenChange(nextOpen)}
      {...(onOpenChangeComplete !== undefined ? { onOpenChangeComplete } : {})}
      modal={modal}
      disablePointerDismissal={disablePointerDismissal}>
      {children}
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Swipe down to close — only while the dialog is a full-screen sheet
// ---------------------------------------------------------------------------

// Pełny ekran = viewport < 640 px (media query w AppDialog.module.css) albo
// ramka telefonu na desktopie. Na desktopowej karcie gest nie ma sensu (jest
// przycisk, ESC i tło), a przeciąganie myszą to zaznaczanie tekstu.
const FULLSCREEN_MAX_WIDTH_PX = 639;

function DialogSwipe({
  popupRef,
  headerRef,
  backdropRef,
}: {
  popupRef: RefObject<HTMLDivElement | null>;
  headerRef: RefObject<HTMLDivElement | null>;
  backdropRef: RefObject<HTMLDivElement | null>;
}) {
  // Zamknięcie gestem idzie TYM SAMYM kanałem co przycisk zamknięcia (Base UI
  // Dialog.Close → onOpenChange(false) u rodzica), dlatego klikamy ukryty
  // Close zamiast dublować stan otwarcia w prymitywie.
  const closeRef = useRef<HTMLButtonElement>(null);
  useSwipeDismiss({
    targetRef: popupRef,
    handleRef: headerRef,
    backdropRef,
    direction: 'down',
    onDismiss: () => closeRef.current?.click(),
    shouldStart: () =>
      window.innerWidth <= FULLSCREEN_MAX_WIDTH_PX ||
      popupRef.current?.closest('[data-app-frame="true"]') != null,
  });
  return <Dialog.Close ref={closeRef} hidden tabIndex={-1} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Content — Backdrop + Portal + Popup with title/description
// ---------------------------------------------------------------------------

function AppDialogContent({
  title,
  description,
  closeDisabled = false,
  finalFocus,
  className,
  children,
}: AppDialogContentProps) {
  const tButtons = useTranslations('buttons');
  const popupClass = [styles.popup, className].filter(Boolean).join(' ');
  // Portal into the phone frame on desktop: DECISION in overlayContainer.context.ts.
  //
  // DECISION: no container is passed as `undefined`, NEVER `null`. For
  // FloatingPortal `null` means „container still resolving” and renders
  // nothing, so every dialog outside AppLayout vanished; `undefined` falls
  // through to `document.body`.
  const container = useOverlayContainer();
  const popupRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog.Portal container={container ?? undefined}>
      <Dialog.Backdrop ref={backdropRef} className={styles.backdrop} />
      <Dialog.Popup
        ref={popupRef}
        data-app-section-exclude=''
        className={popupClass}
        {...(finalFocus !== undefined ? { finalFocus } : {})}>
        <DialogSwipe
          popupRef={popupRef}
          headerRef={headerRef}
          backdropRef={backdropRef}
        />
        <div ref={headerRef} className={styles.header}>
          <div className={styles.titleRow}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close
              disabled={closeDisabled}
              render={
                <ButtonAtom
                  variant='ghost'
                  icon={<XIcon size={20} />}
                  ariaLabel={tButtons('cancel')}
                />
              }
            />
          </div>
          {description && (
            <Dialog.Description className={styles.description}>
              {description}
            </Dialog.Description>
          )}
        </div>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

// ---------------------------------------------------------------------------
// Actions — footer slot for buttons
// ---------------------------------------------------------------------------

function AppDialogActions({ children }: AppDialogActionsProps) {
  return <div className={styles.actions}>{children}</div>;
}

function AppDialogBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Close — re-export Dialog.Close with optional styling
// ---------------------------------------------------------------------------

const AppDialogClose = Dialog.Close;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const AppDialogAtom = Object.assign(AppDialogRoot, {
  Content: AppDialogContent,
  Body: AppDialogBody,
  Actions: AppDialogActions,
  Close: AppDialogClose,
  Trigger: Dialog.Trigger,
});

export { AppDialogAtom };
