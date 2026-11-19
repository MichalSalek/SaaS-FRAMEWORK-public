import { useId, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import { CheckIcon } from '@phosphor-icons/react';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  label?: string;
  className?: string;
}

/**
 * `label` is a plain caption in the primitive's own text style. `children` is
 * for a caption the caller styles itself (a consent sentence with a link):
 * it is rendered inside the same clickable label, after the box.
 */
export function CheckboxAtom({
  label,
  checked,
  disabled,
  className,
  children,
  ...rest
}: CheckboxProps) {
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
        <span
          className={clsx(styles.box, {
            [styles.checked ?? '']: checked,
          })}>
          {checked && <CheckIcon size={14} weight='bold' />}
        </span>
        <input
          id={id}
          type='checkbox'
          className={styles.nativeInput}
          checked={checked}
          disabled={disabled}
          {...rest}
        />
        {label && <span className={styles.text}>{label}</span>}
        {children}
      </label>
    </div>
  );
}
