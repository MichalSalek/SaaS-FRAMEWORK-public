// „Ważne przed wizytą” on the client card (owner): one short line the stylist must
// not miss (an allergy, a sensitivity). It stands at the TOP of the card, on every plan (Free
// included), saves itself on blur or Enter, and is shown read-only on her session screen and in
// her notes. The client never sees it.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { InputAtom } from '../../components/Input/Input.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { resolveSaveFeedbackState } from '../../../application/outcome-feedback/outcome-feedback.helpers';
import {
  useClientImportantNote,
  useUpsertClientImportantNote,
} from '../shared/notes/hooks/useClientImportantNote';
import styles from './ClientCardPage.important-note.module.css';
import { useNoteConflict } from '../shared/notes/hooks/useNoteConflict';
import { NoteConflictMolecule } from '../shared/notes/components/NoteConflict.molecule';

/** Clamp by code points, like the server cap (an emoji is one character). */
export function clampImportantNote(value: string): string {
  return Array.from(value.replace(/[\r\n]+/g, ' '))
    .slice(0, VISIT_CONFIG.IMPORTANT_NOTE_MAX)
    .join('');
}

export function ImportantNoteSectionOrganism({
  clientUserId,
}: {
  clientUserId: string;
}) {
  const t = useTranslations('clientCard');
  const tOutcome = useTranslations('components.outcomeFeedback');
  const tButtons = useTranslations('buttons');
  const query = useClientImportantNote(clientUserId);
  const serverNote = query.data?.note ?? '';
  const [note, setNote] = useState(serverNote);
  const [baseline, setBaseline] = useState({
    note: serverNote,
    updatedAt: query.data?.updatedAt ?? null,
  });
  const draftRef = useRef(note);
  const baselineRef = useRef(baseline);
  const upsert = useUpsertClientImportantNote(clientUserId, data => {
    const confirmed = { note: data.note ?? '', updatedAt: data.updatedAt };
    baselineRef.current = confirmed;
    setBaseline(confirmed);
  });
  const conflict = useNoteConflict(upsert.error, upsert.isSuccess, async () => {
    const result = await query.refetch();
    if (result.isError || result.data === undefined) {
      throw new Error('note fetch failed');
    }
    return result.data;
  });
  // Adopt the FIRST server value even though the field mounted empty; afterwards sync only when
  // the field is not dirty (same data-loss guard as the CRM note's hasHydrated).
  const hasHydrated = useRef(query.data !== undefined);
  const isDirty = note.trim() !== baseline.note;
  const isSaving = upsert.isPending;
  const saveFailed = upsert.isError && isDirty && !isSaving;

  useEffect(() => {
    // A keystroke or save acknowledgement can arrive after this render but before its effect.
    if (draftRef.current !== note || baselineRef.current !== baseline) {
      return;
    }
    if (query.data !== undefined && !hasHydrated.current) {
      hasHydrated.current = true;
      if (draftRef.current.trim() === baselineRef.current.note) {
        draftRef.current = serverNote;
        setNote(serverNote);
      }
      const nextBaseline = {
        note: serverNote,
        updatedAt: query.data.updatedAt,
      };
      baselineRef.current = nextBaseline;
      setBaseline(nextBaseline);
      return;
    }
    if (
      query.data !== undefined &&
      !isDirty &&
      draftRef.current.trim() === baselineRef.current.note &&
      !isSaving &&
      !conflict.active
    ) {
      draftRef.current = serverNote;
      setNote(serverNote);
      if (
        baseline.note !== serverNote ||
        baseline.updatedAt !== query.data.updatedAt
      ) {
        const nextBaseline = {
          note: serverNote,
          updatedAt: query.data.updatedAt,
        };
        baselineRef.current = nextBaseline;
        setBaseline(nextBaseline);
      }
    }
  }, [
    query.data,
    isDirty,
    isSaving,
    serverNote,
    note,
    baseline,
    conflict.active,
  ]);

  const save = () => {
    if (
      !conflict.active &&
      (draftRef.current.trim() !== baselineRef.current.note || isSaving)
    ) {
      upsert.mutate({
        note: draftRef.current,
        expectedUpdatedAt: baselineRef.current.updatedAt,
      });
    }
  };

  const feedback = resolveSaveFeedbackState({
    pending: isSaving,
    failed: saveFailed,
    dirty: isDirty,
    // Only a save made here completes the line; opening the card stays quiet.
    acknowledged: upsert.isSuccess,
  });
  const message =
    feedback === 'error'
      ? tOutcome('saveFailed')
      : feedback === 'dirty'
        ? tOutcome('saveDirty')
        : feedback === 'pending'
          ? tOutcome('savePending')
          : feedback === 'complete'
            ? tOutcome('saveDone')
            : t('importantNoteHint');

  return (
    <section
      className={styles.section}
      data-app-section='plain'
      aria-labelledby='important-note-title'>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden='true'>
          <WarningCircleIcon size={22} weight='fill' />
        </span>
        <h2
          id='important-note-title'
          className={styles.title}
          data-app-section-title=''>
          {t('importantNoteTitle')}
        </h2>
      </div>
      {/* No editor while the stored value is unknown: an empty editable field would save
          itself over a note that still exists (see the DECISION in the CRM note section). */}
      {query.isError && query.data === undefined ? (
        <ErrorStateMolecule
          size='inline'
          message={t('importantNoteLoadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      ) : query.data === undefined ? (
        <SkeletonAtom variant='rect' width='100%' height={48} />
      ) : (
        <InputAtom
          value={note}
          placeholder={t('importantNotePlaceholder')}
          aria-label={t('importantNoteTitle')}
          enterKeyHint='done'
          onChange={event => {
            const next = clampImportantNote(event.target.value);
            draftRef.current = next;
            setNote(next);
          }}
          onBlur={save}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      )}
      <CompletionLineMolecule
        state={feedback}
        message={message}
        // The hint is the longest state and the error line with its retry fits the same
        // two lines, so reserving the hint alone keeps the card from jumping.
        reserveMessage={t('importantNoteHint')}>
        {saveFailed && !conflict.active && (
          <ButtonAtom
            type='button'
            variant='text'
            size='sm'
            onMouseDown={event => event.preventDefault()}
            onClick={() =>
              upsert.mutate({
                note: draftRef.current,
                expectedUpdatedAt: baselineRef.current.updatedAt,
              })
            }>
            {tButtons('retry')}
          </ButtonAtom>
        )}
      </CompletionLineMolecule>
      {conflict.state && (
        <NoteConflictMolecule
          state={conflict.state}
          draft={note}
          saving={isSaving}
          onRefresh={() => void conflict.refresh()}
          onUseStored={current => {
            const next = {
              note: current.note ?? '',
              updatedAt: current.updatedAt,
            };
            draftRef.current = next.note;
            baselineRef.current = next;
            setNote(next.note);
            setBaseline(next);
            upsert.reset();
            conflict.dismiss();
          }}
          onOverwrite={expectedUpdatedAt =>
            upsert.mutate({
              note: draftRef.current,
              expectedUpdatedAt,
              exactRevision: true,
            })
          }
        />
      )}
    </section>
  );
}
