import { Menu } from '@base-ui-components/react/menu';
import type { ReactNode, MouseEventHandler } from 'react';
import { CheckIcon, DotsThreeIcon } from '@phosphor-icons/react';
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

interface AppMenuCheckboxItemProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
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
// Checkbox item
// ---------------------------------------------------------------------------

/**
 * An on/off choice inside a menu (which columns a table shows). The row is the
 * item's own row; the box draws the checkbox primitive's box (20px, control
 * frame, inverted ink when on). The menu stays open, so several choices are
 * made in one visit.
 */
function AppMenuCheckboxItem({
  checked,
  onCheckedChange,
  disabled,
  children,
}: AppMenuCheckboxItemProps) {
  return (
    <Menu.CheckboxItem
      className={styles.item}
      checked={checked}
      onCheckedChange={next => onCheckedChange(next)}
      closeOnClick={false}
      {...(disabled !== undefined && { disabled })}>
      <span className={styles.checkBox} data-checked={checked || undefined}>
        {checked && <CheckIcon size={14} weight='bold' aria-hidden='true' />}
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

// ---------------------------------------------------------------------------
// „More” trigger
// ---------------------------------------------------------------------------

/**
 * The ready trigger of a row's „more” menu: a 44px icon button with the
 * three-dots glyph.
 *
 * DECISION: a row's „more” button is THIS component (callers pass the
 * accessible name and at most a placement class); hand-styled triggers had
 * drifted in size, shape and pressed state. A trigger that is not three dots
 * (header user chip, notification bell) keeps `AppMenuAtom.Trigger`.
 */
function AppMenuMoreTrigger({
  label,
  disabled,
  className,
}: AppMenuMoreTriggerProps) {
  const triggerClass = [styles.moreTrigger, 'press-feedback', className]
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
  CheckboxItem: AppMenuCheckboxItem,
  Submenu: AppMenuSubmenu,
  Separator: AppMenuSeparator,
  Trigger: Menu.Trigger,
  MoreTrigger: AppMenuMoreTrigger,
});

export { AppMenuAtom };
