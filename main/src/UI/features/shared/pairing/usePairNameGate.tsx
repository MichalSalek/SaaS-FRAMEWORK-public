// UI/features/shared/pairing/usePairNameGate.tsx
//
// DECISION: onboarding asks only for the role, so a client who signed up by an e-mail link has no
// name and the stylist's request list read „Klientka, Klientka”. The name is asked right before
// her first connection request, in a small dialog, and saved before the request goes out; a
// client who already has one (Google, or given earlier) never sees it. (owner)
//
// DECISION: the public profile passes `confirmation` and always shows the request dialog, named
// or not. The name is saved only when it changed. Cancel does not send the request. Callers
// without `confirmation` (the QR scanner) keep the old gate.

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { normalizeStringCapitalizedWords } from '@kernel/policies/validation/validation.utils';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { useChangeName } from '../../account/hooks/useChangeName';
import {
  PairRequestConfirmDialogMolecule,
  emptyToNull,
  type PairRequestDetails,
} from './PairRequestConfirmDialog.molecule';

export type PairRequestConfirmation = {
  stylistName: string;
  stylistAvatarUrl: string | null;
};

type Send = (details?: PairRequestDetails) => void | Promise<void>;

const nameIsValid = (value: string): boolean =>
  value.length >= VALIDATION_LENGTHS.NAME_MIN &&
  value.length <= VALIDATION_LENGTHS.NAME_MAX;

function nameFromOwnStylistProfile(displayName: string | null | undefined) {
  const [first = ''] = normalizeStringCapitalizedWords(displayName).split(' ');
  return nameIsValid(first) && /\p{L}/u.test(first) ? first : '';
}

export function shouldPersistPairName(
  currentName: string | null | undefined,
  nextName: string
): boolean {
  return nextName.trim() !== (currentName ?? '').trim();
}

export function usePairNameGate(
  currentName: string | null | undefined,
  options?: {
    confirmation?: PairRequestConfirmation;
    ownStylistDisplayName?: string | null | undefined;
  }
): {
  /** Runs `send` now, or after the dialog. Confirmation always opens the dialog. */
  run: (send: Send) => void;
  /** True while the dialog is open, including the `?pair=1` open. */
  isOpen: boolean;
  dialog: ReactNode;
} {
  const t = useTranslations('stylist.nameGate');
  const tConfirm = useTranslations('stylist.pairRequestConfirm');
  const changeName = useChangeName({ successFeedback: 'silent' });
  const confirmation = options?.confirmation;
  const [dialogConfirmation, setDialogConfirmation] = useState<
    PairRequestConfirmation | undefined
  >(undefined);
  const [requestAttempt, setRequestAttempt] = useState(0);
  const [pending, setPending] = useState<Send | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const valid = nameIsValid(trimmed);

  const run = (send: Send) => {
    const savedName = currentName?.trim();
    if (confirmation === undefined && savedName) {
      void send();
      return;
    }
    setDialogConfirmation(confirmation);
    setRequestAttempt(attempt => attempt + 1);
    setFailed(false);
    setNote('');
    // A Google signup already seeds the saved name. The stylist's own profile
    // is only an editable suggestion when that account field is empty.
    setName(
      savedName || nameFromOwnStylistProfile(options?.ownStylistDisplayName)
    );
    setPending(() => send);
  };

  const close = () => {
    if (saving) {
      return;
    }
    setPending(null);
  };

  const submitNameOnly = () => {
    if (!valid || pending === null || saving) {
      return;
    }
    setSaving(true);
    changeName.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          const send = pending;
          setPending(null);
          setSaving(false);
          void send();
        },
        onError: () => {
          setFailed(true);
          setSaving(false);
        },
      }
    );
  };

  const submitConfirm = () => {
    if (pending === null || saving || !valid) {
      return;
    }
    const send = pending;
    const details: PairRequestDetails = {
      note: emptyToNull(note),
    };
    const deliver = () => {
      void Promise.resolve(send(details))
        .then(() => {
          setPending(null);
        })
        // The HTTP interceptor owns request failures; they must not appear as an invalid name.
        .catch(() => undefined)
        .finally(() => {
          setSaving(false);
        });
    };
    if (!shouldPersistPairName(currentName, trimmed)) {
      setSaving(true);
      deliver();
      return;
    }
    setSaving(true);
    changeName.mutate(
      { name: trimmed },
      {
        onSuccess: () => deliver(),
        onError: () => {
          setFailed(true);
          setSaving(false);
        },
      }
    );
  };

  const dialog =
    dialogConfirmation === undefined ? (
      <AppDialogAtom
        open={pending !== null}
        onOpenChange={open => {
          if (!open) {
            close();
          }
        }}>
        <AppDialogAtom.Content title={t('title')} description={t('body')}>
          <AppDialogAtom.Body>
            <form
              id='pair-name-gate'
              onSubmit={event => {
                event.preventDefault();
                submitNameOnly();
              }}>
              <InputAtom
                type='text'
                label={t('label')}
                placeholder={t('placeholder')}
                autoComplete='given-name'
                value={name}
                onChange={event => setName(event.target.value)}
                maxLength={VALIDATION_LENGTHS.NAME_MAX}
                disabled={saving}
                {...(failed ? { error: t('error') } : {})}
              />
            </form>
          </AppDialogAtom.Body>
          <AppDialogAtom.Actions>
            <ButtonAtom
              type='submit'
              form='pair-name-gate'
              variant='primary'
              size='md'
              disabled={!valid || saving}
              loading={saving}>
              {t('submit')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    ) : (
      <AppDialogAtom
        open={pending !== null}
        onOpenChange={open => {
          if (!open) {
            close();
          }
        }}>
        <AppDialogAtom.Content
          title={tConfirm('title')}
          description={tConfirm('intro', {
            name: dialogConfirmation.stylistName,
          })}
          closeDisabled={saving}>
          <AppDialogAtom.Body>
            <PairRequestConfirmDialogMolecule
              key={requestAttempt}
              stylistName={dialogConfirmation.stylistName}
              stylistAvatarUrl={dialogConfirmation.stylistAvatarUrl}
              name={name}
              onNameChange={setName}
              note={note}
              onNoteChange={setNote}
              nameError={failed ? t('error') : null}
              saving={saving}
              submitDisabled={!valid}
              onSubmit={submitConfirm}
              onCancel={close}
            />
          </AppDialogAtom.Body>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    );

  return { run, isOpen: pending !== null, dialog };
}
