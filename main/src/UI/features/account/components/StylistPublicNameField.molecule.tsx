// UI/features/account/components/StylistPublicNameField.molecule.tsx
//
// The public name of the stylist's profile („Imię lub nazwa na profilu”).
// Onboarding asks only for the role (owner), so a stylist who
// skipped the card after her first photo sets her name HERE; before this field
// the dashboard step „wizytówka” led to a screen that could not complete it.
// Saved on blur through ACCOUNT_DISPLAY_NAME_CHANGE (its own endpoint, which
// also gives the profile its address when it has none), outside the section's
// single-flight queue because that queue speaks UPDATE_STYLIST_PROFILE only.

import { useRef, useState } from 'react';
import type { SafeStylistAccountWire } from '@kernel/domain/user/user.contract-schemas';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { InputAtom } from '../../../components/Input/Input.atom';
import { changeDisplayName_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { invalidateStylistProfileCaches } from '../../shared/profile/invalidate-stylist-profile.helper';

export function StylistPublicNameFieldMolecule({
  stylistAccount,
}: {
  stylistAccount: SafeStylistAccountWire;
}) {
  const accountId = stylistAccount.account_id;
  const savedName = stylistAccount.display_name;
  const t = useTranslations('account.profile');
  const queryClient = useQueryClient();
  const [name, setName] = useState(savedName ?? '');
  const [failed, setFailed] = useState(false);
  // Re-seed only when the account changes (same rule as the section's fields).
  const seededForRef = useRef(accountId);
  if (seededForRef.current !== accountId) {
    seededForRef.current = accountId;
    setName(savedName ?? '');
    setFailed(false);
  }
  const mutation = useMutation({
    mutationFn: (displayName: string) =>
      changeDisplayName_IO({ display_name: displayName }),
    onSuccess: () => {
      setFailed(false);
      invalidateStylistProfileCaches(queryClient);
    },
    onError: () => setFailed(true),
  });

  const commit = () => {
    const next = name.trim();
    if (next !== name) {
      setName(next);
    }
    // The endpoint has no „clear”: an empty or too short name keeps the saved
    // one, the same floor the profile card uses.
    if (
      next.length < VALIDATION_LENGTHS.DISPLAY_NAME_MIN ||
      next === (savedName ?? '') ||
      mutation.isPending
    ) {
      return;
    }
    mutation.mutate(next);
  };

  return (
    <InputAtom
      label={t('displayNameLabel')}
      value={name}
      onChange={e =>
        setName(e.target.value.slice(0, VALIDATION_LENGTHS.DISPLAY_NAME_MAX))
      }
      maxLength={VALIDATION_LENGTHS.DISPLAY_NAME_MAX}
      autoComplete='name'
      error={failed ? t('fieldNotSaved') : undefined}
      onBlur={commit}
      // Enter commits, like the other one-line fields of the form.
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
