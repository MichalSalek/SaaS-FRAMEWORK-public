// UI/features/account/components/ChangeEmailDialog.organism.tsx
// „Zmień e-mail”: one field, the link goes to the new address (verification
// flow). Split out of AccountInfoSection to keep both files under 300 lines.
// Stack: TQ v5 + CSS Modules + Phosphor Icons + AppDialog.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { userValidators } from '@kernel/policies/validation/user.validation';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { useChangeEmail } from '../hooks/useChangeEmail';
import styles from './AccountInfoSection.module.css';

interface ChangeEmailDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ChangeEmailDialogOrganism({
  open,
  onClose,
}: ChangeEmailDialogProps) {
  const t = useTranslations('account.info');
  const tValidation = useTranslations('validation');
  const [draftEmail, setDraftEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailShake, setEmailShake] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const {
    mutate: mutateEmail,
    isPending: isEmailPending,
    reset: resetEmailMutation,
  } = useChangeEmail();

  // Every opening starts clean, and focus lands in the field (focus
  // management replaces the autoFocus prop — WCAG: programmatic focus).
  useEffect(() => {
    if (open) {
      setDraftEmail('');
      setEmailError('');
      resetEmailMutation();
      emailInputRef.current?.focus();
    }
  }, [open, resetEmailMutation]);

  const handleEmailSubmit = () => {
    const validation = userValidators.userChangeEmail({ email: draftEmail });
    if (!validation.__isValid) {
      // DECISION (nie usuwaj tego komentarza) — 2026-10-08:
      // walidator zwraca KLUCZE kernela (`validation.email.*`, sklejone
      // spacją, gdy padną oba sprawdzenia), a pole pokazywało je dosłownie.
      // Pole dostaje jeden przetłumaczony komunikat.
      setEmailError(
        tValidation(
          validation.email?.includes('noSpaces') === true
            ? 'email.noSpaces'
            : 'email.invalid'
        )
      );
      setEmailShake(true);
      return;
    }
    setEmailError('');
    // onSuccess tylko zamyka dialog; oba toasty (sukces
    // USER_EMAIL_CHANGE_REQUESTED i błąd) pushuje interceptor http
    // (event-bus Stage 1) — lokalny push byłby duplikatem.
    mutateEmail(
      { email: draftEmail },
      {
        onSuccess: onClose,
        // Server reject: shake only — the toast itself stays owned by the
        // interceptor, so no local snackbar here.
        onError: () => {
          setEmailShake(true);
        },
      }
    );
  };

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={next => {
        // Escape w trakcie wysyłki nie zamyka dialogu (parytet z backdropem
        // i przyciskiem Anuluj, które są wtedy wyłączone).
        if (!next && !isEmailPending) {
          onClose();
        }
      }}
      disablePointerDismissal={isEmailPending}>
      <AppDialogAtom.Content
        title={t('changeEmailDialogTitle')}
        description={t('changeEmailDialogDesc')}>
        {/* Formularz = Enter w polu wysyła link (wcześniej Enter nie robił
            nic). `display: contents`, żeby nie ruszać układu popupu. */}
        <form
          className={styles.dialogForm}
          noValidate
          onSubmit={e => {
            e.preventDefault();
            if (!isEmailPending && draftEmail.trim().length > 0) {
              handleEmailSubmit();
            }
          }}>
          <div className={styles.dialogBody}>
            <InputAtom
              ref={emailInputRef}
              label={t('newEmailLabel')}
              type='email'
              value={draftEmail}
              autoComplete='email'
              autoCapitalize='none'
              spellCheck={false}
              enterKeyHint='send'
              onChange={e => {
                setDraftEmail(e.target.value);
                if (emailError) {
                  setEmailError('');
                }
              }}
              disabled={isEmailPending}
              error={emailError || undefined}
            />
          </div>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='ghost'
              size='md'
              disabled={isEmailPending}
              onClick={onClose}>
              {t('changeEmailCancelCta')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              type='submit'
              disabled={!isEmailPending && draftEmail.trim().length === 0}
              loading={isEmailPending}
              shake={emailShake}
              onShakeEnd={() => setEmailShake(false)}>
              {isEmailPending
                ? t('changeEmailPending')
                : t('changeEmailSubmitCta')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </form>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
