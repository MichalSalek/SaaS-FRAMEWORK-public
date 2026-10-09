import {
  useId,
  type InputHTMLAttributes,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import styles from './Input.module.css';

// `date` and `number` keep the browser's own picker and keypad; the field,
// its label and its error are still this atom's (S126: three admin pages drew
// a local date field because the union stopped at text types).
type BaseInputType =
  'text' | 'email' | 'password' | 'search' | 'tel' | 'date' | 'number';

interface CommonProps {
  label?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
}

export type InputProps = CommonProps &
  (
    | ({
        multiline?: false;
        type?: BaseInputType;
        ref?: Ref<HTMLInputElement>;
      } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>)
    | ({
        multiline: true;
        ref?: Ref<HTMLTextAreaElement>;
      } & TextareaHTMLAttributes<HTMLTextAreaElement>)
  );

export function InputAtom(props: InputProps) {
  const generatedId = useId();

  if (props.multiline) {
    const {
      label,
      error,
      className,
      multiline: _,
      disabled,
      ref,
      ...rest
    } = props;
    const id = rest.id ?? generatedId;

    return (
      <div
        className={clsx(
          styles.wrapper,
          {
            [styles.hasError ?? '']: Boolean(error),
            [styles.isDisabled ?? '']: disabled,
          },
          className
        )}>
        {label && (
          <label htmlFor={id} className={styles.label}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={styles.textarea}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          {...rest}
        />
        {error && (
          <span id={`${id}-error`} className={styles.error} role='alert'>
            {error}
          </span>
        )}
      </div>
    );
  }

  const {
    label,
    error,
    className,
    type = 'text',
    disabled,
    ref,
    ...rest
  } = props;
  const id = rest.id ?? generatedId;
  const isSearch = type === 'search';

  return (
    <div
      className={clsx(
        styles.wrapper,
        {
          [styles.hasError ?? '']: Boolean(error),
          [styles.isDisabled ?? '']: disabled,
        },
        className
      )}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
      <div className={styles.inputContainer}>
        {isSearch && (
          <span className={styles.searchIcon}>
            <MagnifyingGlassIcon size={16} />
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type={type}
          className={clsx(styles.input, {
            [styles.withSearchIcon ?? '']: isSearch,
          })}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          {...rest}
        />
      </div>
      {error && (
        <span id={`${id}-error`} className={styles.error} role='alert'>
          {error}
        </span>
      )}
    </div>
  );
}
