// UI/features/sessions/SessionDetailPage.blocks.molecule.tsx
// Note blocks of the stylist's session detail:
//   - ClientNoteCallout   (the client's message, read-only)
//   - StylistNoteCallout  (the stylist's private note, editable)
// The photos live in ./SessionPhotos.organism.tsx, the archive in
// ./SessionDetailPage.archive.organism.tsx.

import type { ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { resolveSaveFeedbackState } from '../../../application/outcome-feedback/outcome-feedback.helpers';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { InputAtom } from '../../components/Input/Input.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './SessionDetailPage.module.css';
import type { TSessions } from './sessionTime.formatters';

/* ============================================================
 * CLIENT NOTE CALLOUT — her voice.
 *
 * DECISION: the client's message must read at a glance as HERS, not the stylist's. This used to be
 * done with a cool info tint and a tinted frame; the owner's "biel na papierze" standard (no tinted
 * cards, no frames) removed both. The difference is now structural: her message is read-only text
 * in a white box under its own label, the stylist's note is a field. When she wrote nothing, one
 * quiet line on paper says so (an empty box told the stylist nothing and cost 100px).
 * ============================================================ */

export function ClientNoteCalloutMolecule({
  clientNote,
  t,
}: {
  clientNote: string | null;
  t: TSessions;
}) {
  const lang = useCurrentLang();
  const hasNote = clientNote !== null && clientNote.length > 0;
  if (!hasNote) {
    return <p className={styles.quietLine}>{t('inboxClientNoteEmpty')}</p>;
  }
  return (
    <section className={styles.clientCallout} data-app-section='plain'>
      <h2 className={styles.blockLabel} data-app-section-title=''>
        {t('inboxClientNoteTitle')}
      </h2>
      <p className={styles.calloutBody} lang={lang}>
        {clientNote}
      </p>
    </section>
  );
}

/* ============================================================
 * STYLIST NOTE — private, saved on blur.
 *
 * DECISION: a labelled field standing directly on paper: the field is the white surface (a white
 * card around a white field was a box in a box). The line under it says the note is private; a
 * reserved line below carries "Zapisywanie..." or the save-failed marker, so nothing shifts while
 * typing. Save-on-blur (mutation already wired).
 * ============================================================ */

export function StylistNoteCalloutMolecule({
  noteValue,
  onChange,
  onBlur,
  isSaving,
  saveFailed,
  dirty,
  acknowledged,
  onRetrySave,
  t,
}: {
  noteValue: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  isSaving: boolean;
  /** Last save failed and nothing newer is in flight — text is still local. */
  saveFailed: boolean;
  dirty: boolean;
  acknowledged: boolean;
  onRetrySave: () => void;
  t: TSessions;
}) {
  const tOutcome = useTranslations('components.outcomeFeedback');
  const feedback = resolveSaveFeedbackState({
    pending: isSaving,
    failed: saveFailed,
    dirty,
    acknowledged,
  });
  const status = (
    <CompletionLineMolecule
      state={feedback}
      message={
        feedback === 'pending'
          ? tOutcome('savePending')
          : feedback === 'error'
            ? tOutcome('saveFailed')
            : feedback === 'complete'
              ? tOutcome('saveDone')
              : tOutcome('saveDirty')
      }
      reserveMessage={tOutcome('saveFailed')}
      reserveAction={
        <ButtonAtom variant='text' size='sm'>
          {t('retryBtn')}
        </ButtonAtom>
      }>
      {saveFailed && (
        <ButtonAtom
          variant='text'
          size='sm'
          onMouseDown={event => event.preventDefault()}
          onClick={onRetrySave}>
          {t('retryBtn')}
        </ButtonAtom>
      )}
    </CompletionLineMolecule>
  );

  return (
    <section className={styles.note}>
      <InputAtom
        multiline
        label={t('noteTitle')}
        placeholder={t('notePlaceholder')}
        value={noteValue}
        onChange={(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        onBlur={onBlur}
        rows={3}
        maxLength={SESSION_CONTAINER_CONFIG.SESSION_NOTE_MAX_LENGTH}
      />
      <p className={styles.noteHint}>{t('notePrivacyHint')}</p>
      {/* Always mounted, one line tall: saving and the failure marker appear
          without pushing the page. */}
      <div className={styles.noteStatus}>{status}</div>
    </section>
  );
}
