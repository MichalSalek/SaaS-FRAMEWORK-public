// UI/features/salon-staff/SalonStaffDialogs.composition.tsx
// Invite dialog (one field, one filled action, the validation message under
// the field) and the removal confirmation that names the person.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EnvelopeIcon } from '@phosphor-icons/react';
import { VALIDATION_REGEX } from '@kernel/policies/validation.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import type { SalonStaffRemoveVariant } from './salonStaffView.helpers';
import styles from './SalonStaffPage.module.css';

interface SalonStaffDialogsProps {
  // Invite
  isInviteOpen: boolean;
  inviteEmail: string;
  isInvitePending: boolean;
  /** Server-side invite failure (mutation.isError) — drives the submit shake. */
  inviteError: boolean;
  onInviteOpenChange: (open: boolean) => void;
  onInviteEmailChange: (email: string) => void;
  onInviteSubmit: () => void;
  // Remove
  removeName: string | null;
  removeVariant?: SalonStaffRemoveVariant;
  isRemovePending: boolean;
  onRemoveCancel: () => void;
  onRemoveConfirm: () => void;
}

export function SalonStaffDialogsComposition({
  isInviteOpen,
  inviteEmail,
  isInvitePending,
  inviteError,
  onInviteOpenChange,
  onInviteEmailChange,
  onInviteSubmit,
  removeName,
  removeVariant = 'remove',
  isRemovePending,
  onRemoveCancel,
  onRemoveConfirm,
}: SalonStaffDialogsProps) {
  const t = useTranslations('salon.staff');
  const tValidation = useTranslations('validation');
  const isRemoveOpen = removeName !== null;
  const isFreeSlot = removeVariant === 'freeSlot';
  const removeBody = isFreeSlot
    ? t('freeSlotDialogBody')
    : removeVariant === 'removeInactive'
      ? // The masked name („Konto nieaktywne”) does not read as a person.
        t('removeInactiveDialogBody')
      : t('removeDialog.body', { name: removeName ?? '' });
  const [shake, setShake] = useState(false);
  // The message shows only after she tried to send: not while she is typing
  // the first characters of a still incomplete address.
  const [wasAttempted, setWasAttempted] = useState(false);

  const trimmedEmail = inviteEmail.trim();
  const isEmailValid =
    trimmedEmail !== '' && VALIDATION_REGEX.EMAIL.test(trimmedEmail);
  const emailError =
    wasAttempted && !isEmailValid ? tValidation('email.invalid') : undefined;

  // Server-side invite rejection → shake the submit.
  useEffect(() => {
    if (inviteError) {
      setShake(true);
    }
  }, [inviteError]);

  // DECISION (nie usuwaj tego komentarza) — S126: the submit used to be
  // DISABLED for an empty or malformed address, so a tap did nothing and said
  // nothing. It stays enabled; a bad address shakes it and puts the message
  // under the field, where the correction happens.
  const handleInviteAttempt = () => {
    if (!isEmailValid) {
      setWasAttempted(true);
      setShake(true);
      return;
    }
    onInviteSubmit();
  };

  return (
    <>
      {/* Esc / close button are ignored while a request is in flight: closing
          mid-send left the user without the result of an invite already sent
          (success or failure landed on a dialog that was gone). */}
      <AppDialogAtom
        open={isInviteOpen}
        onOpenChange={open => {
          if (!open && isInvitePending) {
            return;
          }
          if (!open) {
            setWasAttempted(false);
          }
          onInviteOpenChange(open);
        }}
        disablePointerDismissal>
        <AppDialogAtom.Content
          title={t('inviteDialog.title')}
          description={t('inviteDialog.description')}
          closeDisabled={isInvitePending}>
          <div className={styles.dialogBody}>
            <InputAtom
              label={t('inviteDialog.emailLabel')}
              type='email'
              inputMode='email'
              autoComplete='email'
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
              placeholder='email@example.com'
              value={inviteEmail}
              error={emailError}
              onChange={e => onInviteEmailChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isInvitePending) {
                  e.preventDefault();
                  handleInviteAttempt();
                }
              }}
              disabled={isInvitePending}
            />
            <ButtonAtom
              variant='primary'
              size='lg'
              icon={<EnvelopeIcon size={18} weight='bold' />}
              onClick={handleInviteAttempt}
              shake={shake}
              onShakeEnd={() => setShake(false)}
              disabled={isInvitePending}
              aria-busy={isInvitePending}
              className={styles.dialogSubmit}>
              {t('inviteDialog.submit')}
            </ButtonAtom>
          </div>
        </AppDialogAtom.Content>
      </AppDialogAtom>

      <AppDialogAtom
        open={isRemoveOpen}
        onOpenChange={open => {
          // Same rule as the invite dialog: no dismissal mid-request. Closing
          // here also flipped the page's remove variant, so a „free the seat”
          // removal finished with the plain „removed” message.
          if (!open && !isRemovePending) {
            onRemoveCancel();
          }
        }}
        disablePointerDismissal>
        <AppDialogAtom.Content
          closeDisabled={isRemovePending}
          title={
            isFreeSlot ? t('freeSlotDialogTitle') : t('removeDialog.title')
          }
          description={removeBody}>
          {/* The destructive answer wears the danger look of the primitive
              (colour, no fill), never the raspberry of a main action. */}
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              size='md'
              disabled={isRemovePending}
              onClick={onRemoveCancel}>
              {t('removeDialog.cancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='danger'
              size='md'
              onClick={onRemoveConfirm}
              aria-busy={isRemovePending}
              disabled={isRemovePending}>
              {isFreeSlot ? t('freeSlotBtn') : t('removeDialog.confirm')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}
