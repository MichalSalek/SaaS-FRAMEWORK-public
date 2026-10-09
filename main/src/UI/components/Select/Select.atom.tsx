import { useId, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';
import { CaretDownIcon } from '@phosphor-icons/react';
import styles from './Select.module.css';

interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'children'
> {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  /** Field error, shown under the control (the same contract as InputAtom). */
  error?: string | undefined;
  className?: string;
}

export function SelectAtom({
  label,
  options,
  placeholder,
  error,
  disabled,
  className,
  value,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  const hasError = Boolean(error);

  return (
    <div
      className={clsx(
        styles.wrapper,
        {
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
            <option key={opt.value} value={opt.value}>
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
