// UI/features/account/components/StylistProfileContactBox.molecule.tsx
// The box „Kontakt”: phone, website and Instagram. The city lives in the
// location box. Autosaved by the section on blur.

import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  VALIDATION_LENGTHS,
  VALIDATION_SOCIAL,
} from '@kernel/policies/validation.config';
import { InputAtom } from '../../../components/Input/Input.atom';
import { ProfileManageSectionMolecule } from '../../shared/profile/ProfileManageSection.molecule';
import { StylistWebsiteFieldMolecule } from './StylistWebsiteField.molecule';
import { ExternalLinksFieldMolecule } from '../../shared/profile/ExternalLinksField.molecule';
import styles from './StylistProfileSection.module.css';

// Regex source mirroring INSTAGRAM_HANDLE in
// shared-kernel/policies/validation/misc.validation.ts.
const INSTAGRAM_PATTERN = `^[A-Za-z0-9._]{1,${VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX}}$`;

export function StylistProfileContactBoxMolecule({
  values,
  setters,
  sharedWithSalon,
  instagramError,
  onCommitLocation,
  onCommitInstagram,
  onCommitLinks,
  onKeyDown,
  saveLine,
}: {
  values: {
    phone: string;
    website: string;
    instagram: string;
    links: string[];
  };
  setters: {
    setPhone: (next: string) => void;
    setWebsite: (next: string) => void;
    setInstagram: (next: string) => void;
    setLinks: (next: string[]) => void;
  };
  /** She owns a salon: its profile shows these same contact details. */
  sharedWithSalon: boolean;
  instagramError: string | undefined;
  onCommitLocation: () => void;
  onCommitInstagram: () => void;
  onCommitLinks: (next: string[]) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  saveLine: ReactNode;
}) {
  const t = useTranslations('account.profile');
  return (
    <ProfileManageSectionMolecule
      id='profile-contact'
      title={t('contactSection')}
      status={saveLine}
      {...(sharedWithSalon && { description: t('contactSharedWithSalon') })}>
      <div className={styles.field}>
        <InputAtom
          label={t('phoneLabel')}
          type='tel'
          inputMode='tel'
          value={values.phone}
          onChange={e =>
            setters.setPhone(
              e.target.value.slice(0, VALIDATION_LENGTHS.PHONE_FIELD_MAX)
            )
          }
          maxLength={VALIDATION_LENGTHS.PHONE_FIELD_MAX}
          onBlur={onCommitLocation}
          onKeyDown={onKeyDown}
        />
        <p className={styles.hint}>{t('phoneHint')}</p>
      </div>
      <StylistWebsiteFieldMolecule
        value={values.website}
        onChange={setters.setWebsite}
        onCommit={onCommitLocation}
        onKeyDown={onKeyDown}
      />
      {/* No maxLength: a pasted Instagram profile link is longer than the account name, and a link cut on
          the fly could not be unpacked any more (normalised on save, saveInstagram). The server checks the
          name length anyway. */}
      <div className={styles.field}>
        <InputAtom
          label={t('instagramLabel')}
          value={values.instagram}
          onChange={e => setters.setInstagram(e.target.value)}
          autoComplete='off'
          autoCapitalize='none'
          autoCorrect='off'
          spellCheck={false}
          pattern={INSTAGRAM_PATTERN}
          error={instagramError}
          onBlur={onCommitInstagram}
          onKeyDown={onKeyDown}
        />
        <p className={styles.hint}>{t('instagramHint')}</p>
      </div>
      <ExternalLinksFieldMolecule
        value={values.links}
        onChange={setters.setLinks}
        onCommit={onCommitLinks}
        labels={{
          title: t('linksTitle'),
          hint: t('linksHint'),
          inputLabel: t('linksInputLabel'),
          add: t('linksAdd'),
          remove: t('linksRemove'),
          invalid: t('linksInvalid'),
        }}
      />
    </ProfileManageSectionMolecule>
  );
}
