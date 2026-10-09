import { Select } from '@base-ui-components/react/select';
import type { ReactNode } from 'react';
import styles from './AppSelect.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppSelectOption<V extends string = string> {
  label: string;
  value: V;
  disabled?: boolean;
}

interface AppSelectProps<V extends string = string> {
  /** Currently selected value (controlled) */
  value: V;
  /** Callback when value changes */
  onValueChange: (value: V) => void;
  /** List of options */
  options: ReadonlyArray<AppSelectOption<V>>;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Extra CSS class for the trigger */
  className?: string;
  /** Accessible label (required when no visible label exists) */
  'aria-label'?: string;
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AppSelectAtom<V extends string = string>({
  value,
  onValueChange,
  options,
  disabled,
  className,
  'aria-label': ariaLabel,
}: AppSelectProps<V>) {
  const triggerClass = [styles.trigger, className].filter(Boolean).join(' ');

  return (
    <Select.Root
      // `items` lets <Select.Value /> render the option LABEL. Without it Base
      // UI serialises the raw value, so the closed trigger showed the value
      // string while the open list showed the labels.
      items={options}
      value={value}
      onValueChange={nextValue => {
        if (nextValue !== null) {
          onValueChange(nextValue as V);
        }
      }}
      {...(disabled !== undefined && { disabled })}>
      <Select.Trigger className={triggerClass} aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon className={styles.icon}>
          <ChevronIcon />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner className={styles.positioner} sideOffset={4}>
          <Select.Popup className={styles.popup}>
            <Select.ScrollUpArrow className={styles.scrollArrow} />
            <Select.List className={styles.list}>
              {options.map(opt => (
                <Select.Item
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled === true}
                  className={styles.item}>
                  <Select.ItemIndicator className={styles.itemIndicator}>
                    <CheckIcon />
                  </Select.ItemIndicator>
                  <Select.ItemText className={styles.itemText}>
                    {opt.label}
                  </Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
            <Select.ScrollDownArrow className={styles.scrollArrow} />
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

// ---------------------------------------------------------------------------
// Internal icons
// ---------------------------------------------------------------------------

function ChevronIcon() {
  return (
    <svg
      width='10'
      height='14'
      viewBox='0 0 10 14'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <path d='M1 5L5 1.5L9 5' />
      <path d='M1 9L5 12.5L9 9' />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width='12'
      height='12'
      viewBox='0 0 12 12'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      <path d='M2 6L5 9L10 3' />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { AppSelectAtom };
