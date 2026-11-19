// UI/features/account/components/StylistWebsiteField.molecule.tsx
// „Strona lub Booksy” of the stylist's profile form. Autosaved by the section
// on blur; the https scheme is added at save (normalizeWebsiteUrl), so a bare
// `velvet-nails.example.com` is enough.

import type { KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { InputAtom } from '../../../components/Input/Input.atom';
import styles from './StylistProfileSection.module.css';

export function StylistWebsiteFieldMolecule({
  value,
  onChange,
  onCommit,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const t = useTranslations('account.profile');
  return (
    <div className={styles.field}>
      <InputAtom
        label={t('websiteLabel')}
        // type='text' + inputMode='url': address keyboard on a phone without native `type='url'`
        // validation, which under onBlur autosave would clash with the backend message (one error voice).
        type='text'
        inputMode='url'
        value={value}
        onChange={e =>
          onChange(e.target.value.slice(0, VALIDATION_LENGTHS.WEBSITE_MAX))
        }
        maxLength={VALIDATION_LENGTHS.WEBSITE_MAX}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
