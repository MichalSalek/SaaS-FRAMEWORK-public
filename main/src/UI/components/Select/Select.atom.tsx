import { useId, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';
import { CaretDownIcon } from '@phosphor-icons/react';
import styles from './Select.module.css';

// DECISION: this is the ONE select of the app (native <select>). A second, Base UI popup select
// (`primitives/AppSelect`) lived next to it for admin filters; its option grid kept a 1rem column
// for the check mark, the mark rendered only on the chosen option, so every other option text fell
// into that 1rem column and read „S..”, „K..”. A native picker cannot have that class of bug, opens
// the platform list on a phone and needs no positioning. Do not bring a popup select back for looks.

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children' | 'size' | 'value' | 'onChange'
> {
  label?: string;
  options: ReadonlyArray<SelectOption<V>>;
  value?: V | '';
  /** Typed change: receives the option's own value, never a cast string. */
  onValueChange?: (value: V) => void;
  onChange?: SelectHTMLAttributes<HTMLSelectElement>['onChange'];
  placeholder?: string;
  /** Field error, shown under the control (the same contract as InputAtom). */
  error?: string | undefined;
  /**
   * `field` = a form field (full width, input metrics). `compact` = a control
   * in a filter bar or a row of actions: as wide as its longest option, the
   * small type of the bar, never wider than its line.
   */
  density?: 'field' | 'compact';
  className?: string;
}

export function SelectAtom<V extends string = string>({
  label,
  options,
  placeholder,
  error,
  disabled,
  className,
  value,
  onValueChange,
  onChange,
  density = 'field',
  ...rest
}: SelectProps<V>) {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  const hasError = Boolean(error);

  return (
    <div
      className={clsx(
        styles.wrapper,
        {
          [styles.compact ?? '']: density === 'compact',
          [styles.isDisabled ?? '']: disabled,
          [styles.hasError ?? '']: hasError,
        },
        className
      )}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
      <div className={styles.selectContainer}>
        <select
          id={id}
          className={styles.select}
          disabled={disabled}
          value={value}
          onChange={event => {
            onChange?.(event);
            const picked = options.find(
              option => option.value === event.target.value
            );
            if (picked !== undefined) {
              onValueChange?.(picked.value);
            }
          }}
          // Nothing picked yet: the control shows the placeholder option, in
          // placeholder ink, like an empty text field.
          data-empty={placeholder && value === '' ? '' : undefined}
          {...(hasError && {
            'aria-invalid': true,
            'aria-describedby': `${id}-error`,
          })}
          {...rest}>
          {placeholder && (
            <option value='' disabled>
              {placeholder}
            </option>
          )}
          {options.map(opt => (
            <option
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled === true}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={styles.chevron}>
          <CaretDownIcon size={16} />
        </span>
      </div>
      {error && (
        <span id={`${id}-error`} className={styles.error} role='alert'>
          {error}
        </span>
      )}
    </div>
  );
}
