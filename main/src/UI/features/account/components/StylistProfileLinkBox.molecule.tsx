// UI/features/account/components/StylistProfileLinkBox.molecule.tsx
// The box „Link do Twojego profilu” of the stylist's profile form: the same
// name as the link card at the top of the screen, because it edits that link.
// Autosaved by the section on blur (StylistProfileSection).

import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { SoftBreakTextAtom } from '../../../components/SoftBreakText/SoftBreakText.atom';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { ProfileManageSectionMolecule } from '../../shared/profile/ProfileManageSection.molecule';
import styles from './StylistProfileSection.module.css';

const profileAddress = (slug: string) =>
  `${
    typeof window !== 'undefined' ? window.location.host : BRAND_CONFIG.domain
  }${buildRoute(ROUTES_FRONT.STYLIST_PROFILE, { identifier: slug })}`;

const VANITY_PATTERN = `^[a-z0-9-]{${VALIDATION_LENGTHS.VANITY_URL_MIN},${VALIDATION_LENGTHS.VANITY_URL_MAX}}$`;

export function StylistProfileLinkBoxMolecule({
  value,
  onChange,
  savedValue,
  error,
  onCommit,
  onKeyDown,
  setAction,
  saveLine,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The address the backend holds; '' when the profile has none yet. */
  savedValue: string;
  error: string | undefined;
  onCommit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** The filled „set the address” button, only while the profile has none. */
  setAction?: { loading: boolean; onClick: () => void };
  saveLine: ReactNode;
}) {
  const t = useTranslations('account.profile');
  const tShare = useTranslations('components.profileShare');
  const next = value.trim();
  // The full address a new link makes; the saved one stands in the card above.
  const preview =
    next !== '' && next !== savedValue ? profileAddress(next) : null;
  return (
    <ProfileManageSectionMolecule
      id='profile-link'
      // With no address yet the link card right above has this same title
      // and only says where to set it, so this box names the task instead.
      title={setAction ? tShare('emptyCta') : t('vanityUrlLabel')}
      // The first address has its own filled button, so the box does not
      // also say that it saves itself.
      status={setAction ? undefined : saveLine}>
      <div className={styles.field}>
        <InputAtom
          aria-label={t('vanityUrlLabel')}
          value={value}
          onChange={e =>
            onChange(
              e.target.value
                .toLowerCase()
                .slice(0, VALIDATION_LENGTHS.VANITY_URL_MAX)
            )
          }
          autoComplete='off'
          autoCapitalize='none'
          autoCorrect='off'
          spellCheck={false}
          maxLength={VALIDATION_LENGTHS.VANITY_URL_MAX}
          pattern={VANITY_PATTERN}
          error={error}
          onBlur={onCommit}
          onKeyDown={onKeyDown}
        />
        {preview !== null && (
          <p className={styles.preview}>
            <SoftBreakTextAtom>{preview}</SoftBreakTextAtom>
          </p>
        )}
        <p className={styles.hint}>{t('vanityHint')}</p>
        {/* DECISION: a changed address saves on leaving the field like the rest of the form, with
            no confirmation: the old address stays hers and redirects to the new one for good
            (SCHEMA_DECISIONS.md#profile-link-alias, owner), so nothing already sent or
            printed breaks. One line says so. */}
        {savedValue !== '' && (
          <p className={styles.hint}>{t('vanityChangeWarning')}</p>
        )}
        {setAction && (
          // Clicking takes focus from the field, so the save already started from blur; the button only
          // sends it when nothing is in flight (e.g. Enter + click).
          <ButtonAtom
            variant='primary'
            size='md'
            className={styles.addressCta}
            loading={setAction.loading}
            disabled={next === ''}
            onClick={setAction.onClick}>
            {t('vanitySetCta')}
          </ButtonAtom>
        )}
      </div>
    </ProfileManageSectionMolecule>
  );
}
