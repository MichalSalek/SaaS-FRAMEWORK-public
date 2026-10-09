// UI/features/auth/components/OnboardingStepBasicInfo.tsx
//
// Step 2 — basic info (display name + city) + role-specific phone (stylist).
//
// Stylist: display name + city + phone (optional, validated).
// Client : display name + city.
//
// DECISION (nie usuwaj tego komentarza):
// Salon name / specialization / preferred styles inputs were REMOVED in Wave F
// (production-readiness audit). They were never wired to the backend — no
// matching schema columns (StylistAccount has no salon_name/specialization;
// ClientAccount has no preferred_styles). The "wired to settings in MIG-B3"
// comment from the original implementation was aspirational — MIG-B3 shipped
// on 2026-05-10 without these fields. Collecting data we throw away is an
// anti-pattern (silent drop) and hurts trust. When richer profile editing
// ships in Settings, those fields will be added there with a backend wire.

import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { IdentificationCardIcon } from '@phosphor-icons/react';
import {
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
} from '@kernel/policies/validation.config';
import { checkPhoneLength } from '@kernel/policies/validation/validation.utils';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { OnboardingProfilePreviewMolecule } from './OnboardingProfilePreview.molecule';
import type { OnboardingFormValues } from '../onboarding.types';
import {
  isValidInstagramHandle,
  normalizeInstagramHandle,
} from '../onboarding.helpers';
import styles from '../OnboardingPage.module.css';

// SSOT for length caps lives in shared-kernel/policies/validation.config.ts
const DISPLAY_NAME_MAX = VALIDATION_LENGTHS.DISPLAY_NAME_MAX;
const DISPLAY_NAME_MIN = VALIDATION_LENGTHS.DISPLAY_NAME_MIN;
const CITY_MAX = VALIDATION_LENGTHS.CITY_MAX;
const CITY_MIN = VALIDATION_LENGTHS.CITY_MIN;
// Phone format = kernel SSOT (VALIDATION_REGEX.PHONE_ONBOARDING) — no local copy.
const PHONE_RE = VALIDATION_REGEX.PHONE_ONBOARDING;

// DECISION (nie usuwaj tego komentarza) — LOCKSTEP Z WALIDATOREM SERWERA:
// pole telefonu na onboardingu sprawdza DOKLADNIE to, co `userOnboardAsStylist`
// w kernelu: allowlist znakow (PHONE_ONBOARDING) ORAZ podloge cyfr
// (`checkPhoneLength`). Sam regex to okno 9-20 ZNAKOW, wiec bez drugiego warunku
// front przepuszczalby „(((((((((" (zero cyfr) az do odrzucenia przez backend.
// Oba warunki musza isc razem — jesli zmieniasz jeden, zmien drugi.
const isAcceptablePhone = (value: string): boolean => {
  const trimmed = value.trim();
  return PHONE_RE.test(trimmed) && checkPhoneLength(trimmed) === null;
};

export function OnboardingStepBasicInfoOrganism() {
  const t = useTranslations('pages.onboarding');
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<OnboardingFormValues>();

  const role = watch('role');
  const isStylist = role === 'stylist';
  // DECISION (nie usuwaj tego komentarza):
  // Podgląd wizytówki musi nadążać za pisaniem, więc te dwa pola idą przez
  // `useWatch`, a NIE przez `watch` z kontekstu. `watch` subskrybuje komponent,
  // który wołał `useForm` (kompozycję), a nie to dziecko: pod react-compilerem
  // element dziecka bez propsów jest zapamiętany, więc nowa wartość docierała
  // do formularza (szkic ją zapisywał), ale podgląd stał na placeholderze.
  // Zmierzone S123, ta sama klasa co S40. `useWatch` subskrybuje TEN komponent,
  // wzorzec z sąsiedniego `OnboardingStepRole.organism`.
  const displayName = useWatch<OnboardingFormValues, 'display_name'>({
    control,
    name: 'display_name',
  });
  const addressCity = useWatch<OnboardingFormValues, 'address_city'>({
    control,
    name: 'address_city',
  });

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepHeaderOrb} aria-hidden='true'>
            <IdentificationCardIcon size={26} weight='duotone' />
          </span>
          <TypographyAtom variant='h3' className={styles.stepTitle}>
            {t('basicInfoTitle')}
          </TypographyAtom>
        </div>
        <p className={styles.stepSubtitle}>
          {isStylist
            ? t('basicInfoSubtitleStylist')
            : t('basicInfoSubtitleClient')}
        </p>
      </div>

      {/* Podgląd stoi NAD polami, nie pod nimi: zmierzone przy 390 px, że pod
          polami zaczynał się 187 px poniżej zagięcia, więc wypełniał się poza
          ekranem i cały efekt przepadał. Nad polami wypełnia się na oczach
          piszącej i jest jedynym miejscem w lejku, w którym widać produkt, a nie
          formularz. Klientka nie przechodzi kroku DANE (sekwencja kroków), ale
          gałąź zostaje jawna. */}
      {isStylist ? (
        <OnboardingProfilePreviewMolecule
          displayName={displayName}
          city={addressCity}
        />
      ) : null}

      <div
        className={`${styles.fieldsGrid} ${
          isStylist ? styles.fieldsGridStylist : ''
        }`}>
        {/* F1-11: enterKeyHint='next' — mobile keyboard shows "Next" action key */}
        <InputAtom
          label={t('nameLabel')}
          placeholder={t('namePlaceholder')}
          autoComplete='name'
          maxLength={DISPLAY_NAME_MAX}
          enterKeyHint='next'
          error={errors.display_name?.message}
          {...register('display_name', {
            required: t('nameRequired'),
            // The number comes from the rule itself: the text said „2” while
            // the rule was 3 (found by the copy review, 2026-10-09).
            minLength: {
              value: DISPLAY_NAME_MIN,
              message: t('nameMin', { min: DISPLAY_NAME_MIN }),
            },
            maxLength: {
              value: DISPLAY_NAME_MAX,
              message: t('nameMax', { max: DISPLAY_NAME_MAX }),
            },
          })}
        />

        {/* F1-11: enterKeyHint='done' on last field in group */}
        <InputAtom
          label={t('cityLabel')}
          placeholder={t('cityPlaceholder')}
          autoComplete='address-level2'
          maxLength={CITY_MAX}
          enterKeyHint={isStylist ? 'next' : 'done'}
          error={errors.address_city?.message}
          {...register('address_city', {
            required: t('cityRequired'),
            minLength: { value: CITY_MIN, message: t('cityMin') },
            maxLength: {
              value: CITY_MAX,
              message: t('cityMax', { max: CITY_MAX }),
            },
          })}
        />
        <span className={styles.stepHint}>
          {isStylist ? t('cityHelperStylist') : t('cityHelperClient')}
        </span>

        {isStylist ? (
          <InputAtom
            label={t('phoneLabel')}
            placeholder={t('phonePlaceholder')}
            type='text'
            inputMode='tel'
            autoComplete='tel'
            enterKeyHint='next'
            error={errors.phone?.message}
            {...register('phone', {
              validate: value => {
                if (value === undefined || value === null || value === '') {
                  return true;
                }
                return isAcceptablePhone(value) ? true : t('phoneFormat');
              },
            })}
          />
        ) : null}
        {isStylist ? (
          <span className={styles.stepHint}>{t('phoneHint')}</span>
        ) : null}

        {isStylist ? (
          <InputAtom
            label={t('instagramLabel')}
            placeholder={t('instagramPlaceholder')}
            type='text'
            autoComplete='off'
            autoCapitalize='none'
            spellCheck={false}
            enterKeyHint='done'
            error={errors.instagram_handle?.message}
            {...register('instagram_handle', {
              validate: value => {
                const handle = normalizeInstagramHandle(value);
                return handle === '' || isValidInstagramHandle(handle)
                  ? true
                  : t('instagramFormat');
              },
            })}
          />
        ) : null}
        {isStylist ? (
          <span className={styles.stepHint}>{t('instagramHint')}</span>
        ) : null}
      </div>
    </>
  );
}
