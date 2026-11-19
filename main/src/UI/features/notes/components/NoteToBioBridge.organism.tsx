// UI/features/notes/components/NoteToBioBridge.organism.tsx
// One-time offer on the notes screen: the general note was the field on the
// dashboard that some stylists read as their profile text (owner).
// When that note has text and her public „O mnie” is empty, she is asked once
// whether to show it on her profile.
//
// DECISION: nothing becomes public by itself. „Pokaż na profilu” only opens the profile-text editor
// filled with the note; the text goes public when she presses its save button. The answer
// (save or „Zostaw prywatną”) is remembered on this device (noteBioBridgeKey), so the offer never
// comes back for the same account.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import type { SafeStylistAccountWire } from '@kernel/domain/user/user.contract-schemas';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { OutcomeStateMolecule } from '../../../components/OutcomeFeedback/OutcomeState.molecule';
import { PublicBioEditorOrganism } from '../../shared/profile/PublicBioEditor.organism';
import styles from '../NotesPage.module.css';

export function NoteToBioBridgeOrganism({
  stylistAccount,
  note,
  onAnswered,
  onDismiss,
}: {
  stylistAccount: SafeStylistAccountWire;
  note: string;
  /** She saved the text to her profile: remember it, keep the card for its line. */
  onAnswered: () => void;
  /** „Zostaw prywatną”: remember it and remove the card. */
  onDismiss: () => void;
}) {
  const t = useTranslations('pages.notes');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <section className={styles.bridge} aria-labelledby='notes-bridge-title'>
      <h2 id='notes-bridge-title' className={styles.bridgeTitle}>
        {t('bridgeTitle')}
      </h2>
      {saved ? (
        <OutcomeStateMolecule confirmed message={t('bridgeSaved')} />
      ) : editing ? (
        <PublicBioEditorOrganism
          stylistAccount={stylistAccount}
          mode='confirm-publication'
          initialDraft={note
            .trim()
            .slice(0, VALIDATION_LENGTHS.DESCRIPTION_MAX)}
          saveVariant='primary'
          onSaved={() => {
            setSaved(true);
            onAnswered();
          }}
        />
      ) : (
        <>
          <p className={styles.bridgeBody}>{t('bridgeBody')}</p>
          <div className={styles.bridgeActions}>
            <ButtonAtom
              type='button'
              variant='outlined'
              size='md'
              onClick={() => setEditing(true)}>
              {t('bridgeShow')}
            </ButtonAtom>
            <ButtonAtom
              type='button'
              variant='text'
              size='md'
              onClick={onDismiss}>
              {t('bridgeKeepPrivate')}
            </ButtonAtom>
          </div>
        </>
      )}
    </section>
  );
}
