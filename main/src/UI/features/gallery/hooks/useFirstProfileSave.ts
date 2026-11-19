// Saves the profile card shown after the first photo (owner:
// registration captures the role and optional email opt-in; the public name,
// city, pinning and another opt-in opportunity are asked here after the first
// photo). Four existing operations, each sent only when it changes
// something:
//  1. the public name   → ACCOUNT_DISPLAY_NAME_CHANGE (also gives the profile an address),
//  2. the city           → UPDATE_STYLIST_PROFILE `location`, which REPLACES the whole
//                          location block, so the other fields are sent back as they are,
//  3. pin the new photo  → the gallery pin mutation,
//  4. marketing opt-in   → the e-mail preferences (trial_sequence preserved).
// The name and the city go first and must succeed; pin and consent follow and
// a failure there is reported but does not undo the saved card.

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_EMAIL_PREFERENCES } from '@kernel/models/email/email.dto';
import {
  changeDisplayName_IO,
  updateStylistProfile_IO,
} from '../../../../domain/account/accountIO.possibilities.api';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useTogglePin } from '../../shared/gallery/hooks/useTogglePin';
import { useUpdateEmailPreferences } from '../../shared/email/hooks/useUpdateEmailPreferences';
import { invalidateStylistProfileCaches } from '../../shared/profile/invalidate-stylist-profile.helper';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

export interface FirstProfileInput {
  displayName: string;
  city: string;
  country: string;
  pinPhoto: boolean;
  marketing: boolean;
}

export type FirstProfileSaveStatus = 'idle' | 'pending' | 'saved' | 'error';

export function useFirstProfileSave(galleryRecordId: string): {
  status: FirstProfileSaveStatus;
  save: (input: FirstProfileInput) => Promise<void>;
  skip: (pinPhoto: boolean) => void;
} {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUserAccount();
  const pin = useTogglePin(galleryRecordId);
  const emailPreferences = useUpdateEmailPreferences();
  const [status, setStatus] = useState<FirstProfileSaveStatus>('idle');
  // A ref, not `status`: a second tap before the re-render reads a stale
  // closure in which the save has not started yet.
  const inFlightRef = useRef(false);

  const save = async (input: FirstProfileInput): Promise<void> => {
    const account = currentUser?.stylist_account;
    if (account == null || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setStatus('pending');
    const name = input.displayName.trim();
    const city = input.city.trim();
    try {
      if (name !== '' && name !== (account.display_name ?? '')) {
        await changeDisplayName_IO({ display_name: name });
      }
      if (
        city !== '' &&
        (city !== (account.address_city ?? '') ||
          input.country !== (account.address_country ?? ''))
      ) {
        await updateStylistProfile_IO({
          location: {
            business_name: account.business_name,
            address_street: account.address_street,
            address_city: city,
            address_postal_code: account.address_postal_code,
            address_country: input.country || null,
            phone: account.phone,
            website: account.website,
            description: account.description,
          },
        });
      }
    } catch (error: unknown) {
      // The name may already be saved when the city fails: refresh the screens
      // that show it instead of keeping the old name until the next fetch.
      invalidateStylistProfileCaches(queryClient);
      inFlightRef.current = false;
      setStatus('error');
      trackFlowStep('profile_prompt', 'failed', {
        code: flowErrorCode(error),
      });
      return;
    }

    // Best-effort extras: the card is saved even when one of them fails, and
    // each mutation hook already reports its own failure.
    const pinned = input.pinPhoto
      ? await pin.mutateAsync(false).then(
          () => true,
          () => false
        )
      : false;
    const current = account.email_preferences ?? DEFAULT_EMAIL_PREFERENCES;
    const marketing = input.marketing
      ? await emailPreferences
          .mutateAsync({
            trial_sequence: current.trial_sequence,
            marketing: true,
            source: 'first_photo',
          })
          .then(
            () => true,
            () => false
          )
      : false;

    invalidateStylistProfileCaches(queryClient);
    inFlightRef.current = false;
    setStatus('saved');
    // What actually happened, not what was ticked.
    trackFlowStep('profile_prompt', 'saved', { pinned, marketing });
  };

  // DECISION: skipping the card keeps the pin that is ticked by default. It used to drop the pin
  // too, so a client arriving from the QR code saw "no works yet" on a profile with a published
  // photo. The pin needs no name or city, so skip pins best-effort, like save does.
  const skip = (pinPhoto: boolean) => {
    if (!pinPhoto) {
      return;
    }
    void pin.mutateAsync(false).then(
      () => invalidateStylistProfileCaches(queryClient),
      () => undefined
    );
  };

  return { status, save, skip };
}
