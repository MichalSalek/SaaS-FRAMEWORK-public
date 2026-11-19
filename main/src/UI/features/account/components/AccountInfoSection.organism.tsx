// UI/features/account/components/AccountInfoSection.organism.tsx
// Profile info: avatar (display-only), editable name (autosave), e-mail as a
// read-only fact with the "Change email" action (ChangeEmailDialog.organism).
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useEffect, useRef, useState } from 'react';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import { useTranslations } from 'next-intl';
import { StylistAvatarFieldOrganism } from '../../shared/profile/photo/StylistAvatarField.organism';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useChangeName } from '../hooks/useChangeName';
import { ChangeEmailDialogOrganism } from './ChangeEmailDialog.organism';
import { useSingleFlightSaves } from '../../shared/profile/hooks/useSingleFlightSaves';
import styles from './AccountInfoSection.module.css';

/* ─── Props ─── */

interface AccountInfoSectionProps {
  name: string;
  email: string;
}

/* ─── Component ─── */

export function AccountInfoSectionOrganism({
  name,
  email,
}: AccountInfoSectionProps) {
  const t = useTranslations('account.info');
  const tButtons = useTranslations('buttons');
  const tOutcome = useTranslations('components.outcomeFeedback');
  const [draftName, setDraftName] = useState(name);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  const changeName = useChangeName();
  // The name goes through the same queue as the profile sections (see useSingleFlightSaves): a blur
  // during a save QUEUES the latest value instead of silently dropping it, and a failed save leaves a
  // persistent marker.
  const nameSaves = useSingleFlightSaves<'name', { name: string }>(
    changeName.mutateAsync
  );
  // DECISION: the draft follows the server ONLY when the field shows the previous canonical value
  // (or already the new one). An unconditional reset on every `name` change lost an edit: blur "A"
  // → save in flight → the user types "B" → the "A" success changes `name` → the effect overwrote
  // "B" with "A".
  const syncedNameRef = useRef(name);
  useEffect(() => {
    const previous = syncedNameRef.current;
    syncedNameRef.current = name;
    setDraftName(draft =>
      draft === previous || draft.trim() === name ? name : draft
    );
  }, [name]);

  const lastQueuedRef = useRef<string | null>(null);
  const trimmed = draftName.trim();
  const isDirty = trimmed.length > 0 && trimmed !== name;

  // Autosave (owner directive): the name saves on leaving the field (dirty-only); Enter
  // = blur = save; no Save button.
  // DECISION: no local onSuccess or onError, the HTTP interceptor owns both toasts (three toast
  // layers: main/src/application/http/queryClient.config.ts). suppressGlobalError silences only
  // layer 3.
  const handleSave = () => {
    // DECISION: autosave-only field (no Save button). A blur with an empty/whitespace-only or
    // unchanged value does NOT save (empty = no name), but draftName must then SNAP BACK to the
    // canonical `name`: otherwise the field hangs visually empty with no feedback while the UI
    // drifts from the backend until reload. Snap-back = immediate feedback + whitespace
    // normalization (inline-edit pattern). Reverting to the saved name while another value is saving
    // is a real change: it is queued (see useSingleFlightSaves).
    if (trimmed.length > 0 && trimmed === name && nameSaves.isBusy('name')) {
      nameSaves.save('name', { name: trimmed });
      return;
    }
    if (!isDirty) {
      if (draftName !== name) {
        setDraftName(name);
      }
      // The field is back at the saved value: an earlier failed snapshot is
      // nobody's intent anymore, so the marker and its retry disappear.
      nameSaves.discard('name');
      return;
    }
    lastQueuedRef.current = trimmed;
    nameSaves.save('name', { name: trimmed });
  };

  // DECISION: the name draft also saves on UNMOUNT. Autosave hung only on `blur`, but the Android
  // hardware back removes the screen with the field still focused, without a blur event, so the
  // typed text was lost silently. The save queue is a promise chain (see useSingleFlightSaves), so a
  // save issued in the effect cleanup still completes after unmount. A ref holds the current draft
  // so the effect runs once, and `lastQueuedRef` stops the normal path (blur, then leave) from
  // sending the same name twice.
  const commitOnUnmountRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    commitOnUnmountRef.current = () => {
      if (isDirty && lastQueuedRef.current !== trimmed) {
        nameSaves.save('name', { name: trimmed });
      }
    };
  });
  useEffect(() => () => commitOnUnmountRef.current(), []);

  return (
    <section className={styles.section} data-app-section='bordered'>
      <TypographyAtom variant='h4' data-app-section-title=''>
        {t('sectionTitle')}
      </TypographyAtom>

      <div className={styles.avatarSection}>
        <StylistAvatarFieldOrganism compact />
      </div>

      <div className={styles.form}>
        <InputAtom
          label={t('nameLabel')}
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
        />

        {/* One always-mounted line under the field: silent at rest,
            then „saving”, then a failed save with its retry. The line keeps
            its height, so nothing below moves when the state changes. */}
        <CompletionLineMolecule
          state={
            nameSaves.isSaving
              ? 'pending'
              : nameSaves.failedSections.size > 0
                ? 'error'
                : isDirty
                  ? 'dirty'
                  : changeName.isSuccess
                    ? 'complete'
                    : 'idle'
          }
          message={
            nameSaves.isSaving
              ? tOutcome('savePending')
              : nameSaves.failedSections.size > 0
                ? tOutcome('saveFailed')
                : isDirty
                  ? tOutcome('saveDirty')
                  : changeName.isSuccess
                    ? tOutcome('saveDone')
                    : ''
          }
          reserveMessage={tOutcome('saveFailed')}
          reserveAction={
            <ButtonAtom variant='text' size='sm'>
              {tButtons('retry')}
            </ButtonAtom>
          }>
          {nameSaves.failedSections.size > 0 && !nameSaves.isSaving && (
            <ButtonAtom variant='text' size='sm' onClick={nameSaves.retry}>
              {tButtons('retry')}
            </ButtonAtom>
          )}
        </CompletionLineMolecule>

        {/* E-mail is a fact with one action, not a disabled input: a greyed
            field read as a broken control next to the editable one. */}
        <div className={styles.emailRow}>
          <div className={styles.emailBody}>
            <span className={styles.emailLabel}>{t('emailLabel')}</span>
            <span className={styles.emailValue}>{email}</span>
          </div>
          <ButtonAtom
            variant='outlined'
            size='sm'
            onClick={() => setEmailDialogOpen(true)}
            className={styles.emailAction}
            ariaLabel={t('changeEmailAriaLabel')}>
            {t('changeEmailCta')}
          </ButtonAtom>
        </div>
      </div>

      <ChangeEmailDialogOrganism
        open={emailDialogOpen}
        onClose={() => setEmailDialogOpen(false)}
      />
    </section>
  );
}
