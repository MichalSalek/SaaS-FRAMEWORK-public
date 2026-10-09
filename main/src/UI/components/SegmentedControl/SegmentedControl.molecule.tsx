import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import { useLocale } from 'next-intl';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  /** Replaces the accessible name when the visible label is not enough. */
  ariaLabel?: string;
  /** Kept so existing tabpanels can point at a stable id. */
  id?: string;
  /** id of the tabpanel this option controls. */
  controls?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  ariaLabel: string;
  /** radio: radiogroup + radio + aria-checked. tabs: tablist + tab + aria-selected. */
  semantics?: 'radio' | 'tabs';
  /** md is a 44px tap target. sm stays at least 36px for dense admin toolbars. */
  size?: 'sm' | 'md';
  /** Equal-width options. Breakpoint-only stretch uses --segmented-option-flex. */
  fullWidth?: boolean;
  /** pill children stay pills. control children use the concentric radius. */
  shape?: 'pill' | 'control';
  className?: string;
  style?: CSSProperties;
  /** Extra class on every option (for example the global haptic-press hook). */
  optionClassName?: string;
}

/**
 * One segmented track for filters, periods and in-page tabs.
 * Arrow keys move selection and focus. The track scrolls instead of wrapping.
 */
export function SegmentedControlMolecule<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  semantics = 'radio',
  size = 'md',
  fullWidth = false,
  shape = 'pill',
  className,
  style,
  optionClassName,
}: SegmentedControlProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isTabs = semantics === 'tabs';
  // Liczniki w formacie języka interfejsu (1 234 zamiast 1234), jak przed
  // migracją lokalnych kopii.
  const countFormat = new Intl.NumberFormat(useLocale());
  const hasSelection = options.some(option => option.value === value);

  const focusValue = (next: T) => {
    const root = rootRef.current;
    if (root == null) {
      return;
    }
    const button = root.querySelector<HTMLButtonElement>(
      `[data-segment-value="${CSS.escape(next)}"]`
    );
    button?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const last = options.length - 1;
    if (last < 0) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = index === last ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = index === 0 ? last : index - 1;
    } else if (!isTabs && event.key === 'ArrowDown') {
      nextIndex = index === last ? 0 : index + 1;
    } else if (!isTabs && event.key === 'ArrowUp') {
      nextIndex = index === 0 ? last : index - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = last;
    }
    if (nextIndex == null) {
      return;
    }
    const next = options[nextIndex];
    if (next == null) {
      return;
    }
    event.preventDefault();
    if (next.value !== value) {
      onChange(next.value);
    }
    focusValue(next.value);
  };

  return (
    <div
      ref={rootRef}
      className={clsx(styles.root, className)}
      style={style}
      role={isTabs ? 'tablist' : 'radiogroup'}
      aria-label={ariaLabel}
      aria-orientation='horizontal'
      data-size={size}
      data-shape={shape}
      data-full-width={fullWidth ? 'true' : undefined}>
      {options.map((option, index) => {
        const selected = option.value === value;
        // Roving tabindex needs exactly one tab stop. When `value` matches no
        // option, every segment had tabIndex -1 and the control could not be
        // reached with Tab at all (WAI-ARIA radio group: no checked radio =
        // the first one takes the tab stop).
        const isTabStop = selected || (!hasSelection && index === 0);
        return (
          <button
            key={option.value}
            type='button'
            id={option.id}
            className={clsx(styles.option, optionClassName)}
            role={isTabs ? 'tab' : 'radio'}
            aria-checked={isTabs ? undefined : selected}
            aria-selected={isTabs ? selected : undefined}
            aria-controls={option.controls}
            aria-label={option.ariaLabel}
            tabIndex={isTabStop ? 0 : -1}
            data-segment-value={option.value}
            data-selected={selected ? 'true' : undefined}
            data-has-icon={option.icon != null ? 'true' : undefined}
            onClick={() => {
              if (!selected) {
                onChange(option.value);
              }
            }}
            onKeyDown={event => onKeyDown(event, index)}>
            {option.icon != null && (
              <span
                className={styles.icon}
                data-segment-part='icon'
                aria-hidden='true'>
                {option.icon}
              </span>
            )}
            <span className={styles.label} data-segment-part='label'>
              {option.label}
            </span>
            {option.count != null && (
              <span className={styles.count} data-segment-part='count'>
                {countFormat.format(option.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
