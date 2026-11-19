// UI/features/shared/profile/StylistBioField.molecule.tsx
// The ONE field for the stylist's public „O mnie” text (`description`): the
// profile form on /app/profile and the „O mnie” card on her dashboard both draw
// it, so the limit, the line count and the sentence about who reads it cannot
// drift apart. Saving belongs to the host (autosave on blur on the profile form,
// an explicit button on the card).

import { useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { InputAtom } from '../../../components/Input/Input.atom';
import styles from './PublicBio.module.css';

export function StylistBioFieldMolecule({
  value,
  onChange,
  onBlur,
  label,
  ariaLabel,
  placeholder,
  hint,
  withVisibilityHint = false,
  error,
  rows = 4,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: (() => void) | undefined;
  /** Visible label; omit it when a heading right above names the field. */
  label?: string | undefined;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string | undefined;
  placeholder?: string | undefined;
  /** One quiet line under the field. */
  hint?: string | undefined;
  /** Use the standard line saying who reads the text (clients, on the profile). */
  withVisibilityHint?: boolean;
  error?: string | undefined;
  rows?: number;
}) {
  const hintId = useId();
  const t = useTranslations('components.publicBio');
  const line = hint ?? (withVisibilityHint ? t('visibility') : undefined);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrowFallback(fieldRef, value);
  return (
    <div className={styles.field}>
      <InputAtom
        ref={fieldRef}
        label={label}
        aria-label={label ? undefined : ariaLabel}
        aria-describedby={line && !error ? hintId : undefined}
        multiline
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={event =>
          onChange(
            event.target.value.slice(0, VALIDATION_LENGTHS.DESCRIPTION_MAX)
          )
        }
        maxLength={VALIDATION_LENGTHS.DESCRIPTION_MAX}
        onBlur={onBlur}
        error={error}
      />
      {line && (
        <p id={hintId} className={styles.hint}>
          {line}
        </p>
      )}
    </div>
  );
}

// Growth for browsers without CSS `field-sizing` (Firefox, older WebViews):
// the box takes the text's height, so nothing scrolls inside it.
function useAutoGrowFallback(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string
) {
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field || CSS.supports('field-sizing', 'content')) {
      return;
    }
    const fit = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ref, value]);
}
