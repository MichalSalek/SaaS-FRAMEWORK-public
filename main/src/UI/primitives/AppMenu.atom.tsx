import { Menu } from '@base-ui-components/react/menu';
import type { ReactNode, MouseEventHandler } from 'react';
import { DotsThreeIcon } from '@phosphor-icons/react';
import styles from './AppMenu.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppMenuProps {
  children: ReactNode;
}

interface AppMenuContentProps {
  /** Extra CSS class for the popup */
  className?: string;
  /** Side offset from trigger (default: 8) */
  sideOffset?: number;
  /** Side of the trigger (default: 'bottom') */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Alignment (default: 'start') */
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
}

interface AppMenuItemProps {
  /** CSS class */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Click handler */
  onClick?: MouseEventHandler<HTMLElement>;
  /**
   * `danger` = an action that removes or disconnects something. Carried by the
   * colour of the label and its icon only, never by a tinted row.
   */
  tone?: 'default' | 'danger';
  children: ReactNode;
}

interface AppMenuMoreTriggerProps {
  /** Accessible name; name the row's subject („Więcej: Anna Kowalska”). */
  label: string;
  disabled?: boolean;
  /** PLACEMENT only (a margin, an alignment). Size, shape and states are the
   *  primitive's. */
  className?: string;
}

interface AppMenuSubmenuProps {
  /** Trigger label for the submenu */
  label: ReactNode;
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function AppMenuRoot({ children }: AppMenuProps) {
  return <Menu.Root>{children}</Menu.Root>;
}

// ---------------------------------------------------------------------------
// Content (Portal + Positioner + Popup)
// ---------------------------------------------------------------------------

function AppMenuContent({
  className,
  sideOffset = 8,
  side = 'bottom',
  align = 'start',
  children,
}: AppMenuContentProps) {
  const popupClass = [styles.popup, className].filter(Boolean).join(' ');

  return (
    <Menu.Portal>
      <Menu.Positioner
        className={styles.positioner}
        sideOffset={sideOffset}
        side={side}
        align={align}>
        <Menu.Popup className={popupClass}>{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

function AppMenuItem({
  className,
  disabled,
  onClick,
  tone = 'default',
  children,
}: AppMenuItemProps) {
  const itemClass = [styles.item, className].filter(Boolean).join(' ');

  return (
    <Menu.Item
      className={itemClass}
      data-tone={tone === 'danger' ? 'danger' : undefined}
      {...(disabled !== undefined && { disabled })}
      {...(onClick !== undefined && { onClick })}>
      {children}
    </Menu.Item>
  );
}

// ---------------------------------------------------------------------------
// „More” trigger
// ---------------------------------------------------------------------------

/**
 * The ready trigger of a row's „more” menu: a 44px icon button with the
 * three-dots glyph.
 *
 * DECISION (nie usuwaj tego komentarza) — S126: the primitive shipped only
 * the bare Base UI trigger, so pairing, messaging, the salon team and the
 * stylist profile each styled their own (36 and 44px, round and square, with
 * and without a pressed state) and their own danger item. A row's „more”
 * button is this component; a caller passes the accessible name and, at most,
 * a placement class. A trigger that is NOT three dots (the header user chip,
 * the notification bell) keeps using `AppMenuAtom.Trigger`.
 */
function AppMenuMoreTrigger({
  label,
  disabled,
  className,
}: AppMenuMoreTriggerProps) {
  const triggerClass = [styles.moreTrigger, 'haptic-press', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Menu.Trigger
      className={triggerClass}
      aria-label={label}
      {...(disabled !== undefined && { disabled })}>
      <DotsThreeIcon size={20} weight='bold' aria-hidden='true' />
    </Menu.Trigger>
  );
}

// ---------------------------------------------------------------------------
// Submenu
// ---------------------------------------------------------------------------

function AppMenuSubmenu({ label, children }: AppMenuSubmenuProps) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={styles.triggerItem}>
        {label}
        <span className={styles.submenuChevron} aria-hidden='true'>
          <ChevronRightIcon />
        </span>
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner
          className={styles.positioner}
          sideOffset={4}
          side='right'
          align='start'>
          <Menu.Popup className={styles.popup}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function AppMenuSeparator() {
  return <Menu.Separator className={styles.separator} />;
}

// ---------------------------------------------------------------------------
// Internal icon
// ---------------------------------------------------------------------------

function ChevronRightIcon() {
  return (
    <svg
      width='8'
      height='12'
      viewBox='0 0 8 12'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <path d='M2 2L6 6L2 10' />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const AppMenuAtom = Object.assign(AppMenuRoot, {
  Content: AppMenuContent,
  Item: AppMenuItem,
  Submenu: AppMenuSubmenu,
  Separator: AppMenuSeparator,
  Trigger: Menu.Trigger,
  MoreTrigger: AppMenuMoreTrigger,
});

export { AppMenuAtom };
