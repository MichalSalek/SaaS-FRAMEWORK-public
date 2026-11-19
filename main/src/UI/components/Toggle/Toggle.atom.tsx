import { useId, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Toggle.module.css';

export interface ToggleProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  label?: string;
  className?: string;
}

export function ToggleAtom({
  label,
  checked,
  disabled,
  className,
  ...rest
}: ToggleProps) {
  const generatedId = useId();
  const id = rest.id ?? generatedId;

  return (
    <div
      className={clsx(
        styles.wrapper,
        { [styles.isDisabled ?? '']: disabled },
        className
      )}>
      <label htmlFor={id} className={styles.label}>
        <input
          id={id}
          type='checkbox'
          role='switch'
          className={styles.nativeInput}
          checked={checked}
          disabled={disabled}
          {...rest}
        />
        <span
          className={clsx(styles.track, {
            [styles.trackChecked ?? '']: checked,
          })}>
          <span
            className={clsx(styles.thumb, {
              [styles.thumbChecked ?? '']: checked,
            })}
          />
        </span>
        {label && <span className={styles.text}>{label}</span>}
      </label>
    </div>
  );
}
