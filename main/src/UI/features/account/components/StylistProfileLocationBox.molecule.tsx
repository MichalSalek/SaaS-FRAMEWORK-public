import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import { CountrySelectMolecule } from '../../shared/location/CountrySelect.molecule';
import { InputAtom } from '../../../components/Input/Input.atom';
import { ProfileManageSectionMolecule } from '../../shared/profile/ProfileManageSection.molecule';
import styles from './StylistProfileSection.module.css';

export function StylistProfileLocationBoxMolecule({
  values,
  setters,
  onCountryChange,
  sharedWithSalon,
  cityError,
  onCommit,
  onKeyDown,
  saveLine,
}: {
  values: { city: string; street: string; country: CountryCode | '' };
  onCountryChange: (next: CountryCode) => void;
  setters: {
    setCity: (next: string) => void;
    setStreet: (next: string) => void;
  };
  sharedWithSalon: boolean;
  cityError: string | undefined;
  onCommit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  saveLine: ReactNode;
}) {
  const t = useTranslations('account.profile');
  return (
    <ProfileManageSectionMolecule
      id='profile-location'
      title={t('locationSection')}
      status={saveLine}
      {...(sharedWithSalon && {
        description: t('locationSharedWithSalon'),
      })}>
      <CountrySelectMolecule
        label={t('countryLabel')}
        placeholder={t('countryPlaceholder')}
        value={values.country}
        onValueChange={onCountryChange}
      />
      <InputAtom
        label={t('cityLabel')}
        value={values.city}
        error={cityError}
        onChange={event =>
          setters.setCity(
            event.target.value.slice(0, VALIDATION_LENGTHS.CITY_MAX)
          )
        }
        maxLength={VALIDATION_LENGTHS.CITY_MAX}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
      />
      <div className={styles.field}>
        <InputAtom
          label={t('streetLabel')}
          value={values.street}
          onChange={event =>
            setters.setStreet(
              event.target.value.slice(0, VALIDATION_LENGTHS.STREET_MAX)
            )
          }
          maxLength={VALIDATION_LENGTHS.STREET_MAX}
          onBlur={onCommit}
          onKeyDown={onKeyDown}
        />
        <p className={styles.hint}>{t('streetHint')}</p>
      </div>
    </ProfileManageSectionMolecule>
  );
}
