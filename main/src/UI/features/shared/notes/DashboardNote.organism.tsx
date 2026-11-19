import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { useDashboardNote } from './hooks/useDashboardNote';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import styles from './DashboardNote.module.css';

interface DashboardNoteProps {
  accountType: AccountType;
  /** Words of the screen that hosts the note (the client dashboard, the
   *  stylist's notes screen): the same field is called differently there. */
  copy: { title: string; placeholder: string; hint: string };
}

// The one general private note of an account (`dashboard_note`): the client's
// on her dashboard, the stylist's on her notes screen (/app/notes). Saves by
// itself (debounce + blur, serialized), so the same logic serves both places.
export function DashboardNoteOrganism({
  accountType,
  copy,
}: DashboardNoteProps) {
  const tNote = useTranslations('dashboard.note');
  const tButtons = useTranslations('buttons');
  const tOutcome = useTranslations('components.outcomeFeedback');
  const {
    note,
    isLoading,
    loadFailed,
    retryLoad,
    isRetrying,
    saveNoteAsync,
    isSaving,
  } = useDashboardNote(accountType);
  const [draft, setDraft] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [queuePending, setQueuePending] = useState(false);
  const draftRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const lastSavedValue = useRef<string | null>(null);
  // Saves are SERIALIZED (a promise chain) and carry a generation: debounce + blur
  // could send A and B in parallel, B finished first, A overwrote the server and
  // the UI held B as „saved”. Success counts only for the newest generation; an
  // error undoes the dedup so the next blur can retry.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveGenRef = useRef(0);
  const lastQueuedValue = useRef<string | null>(null);

  // Seed the draft only from a note that was actually READ (see loadFailed).
  useEffect(() => {
    if (!isLoading && !loadFailed && !initialized.current) {
      setDraft(note ?? '');
      draftRef.current = note ?? '';
      lastSavedValue.current = note;
      lastQueuedValue.current = note;
      initialized.current = true;
    }
  }, [isLoading, loadFailed, note]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    // An empty field is as tall as its placeholder: measured on the placeholder
    // text for one synchronous read, or a three-line placeholder is cut after
    // two lines on a phone.
    if (el.value === '' && el.placeholder !== '') {
      el.value = el.placeholder;
      el.style.height = `${el.scrollHeight}px`;
      el.value = '';
      return;
    }
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [draft, autoGrow]);

  // „Saved” and the value dedup only after a CONFIRMED save. The lastSavedValue
  // ref used to be set before sending, so after a network error the same text
  // already counted as „saved” (the next blur = no-op), the bar showed a check
  // and a refresh brought the old note back from the server: a silent loss.
  const persistNote = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const newValue = trimmed === '' ? null : trimmed;
      if (newValue === lastQueuedValue.current) {
        return;
      }
      lastQueuedValue.current = newValue;
      const gen = ++saveGenRef.current;
      setQueuePending(true);
      setSaveFailed(false);
      setShowSaved(false);
      saveChainRef.current = saveChainRef.current
        .then(() => saveNoteAsync(newValue))
        .then(() => {
          lastSavedValue.current = newValue;
          if (gen !== saveGenRef.current) {
            return;
          }
          setQueuePending(false);
          setSaveFailed(false);
          setShowSaved((draftRef.current.trim() || null) === newValue);
        })
        .catch(() => {
          if (gen === saveGenRef.current) {
            setQueuePending(false);
            setSaveFailed(true);
            setShowSaved(false);
          }
          if (lastQueuedValue.current === newValue) {
            lastQueuedValue.current = lastSavedValue.current;
          }
        });
    },
    [saveNoteAsync]
  );

  // Text typed but not yet handed to persistNote (debounce still running).
  // Kept in a ref so the unmount cleanup can flush it: leaving the dashboard
  // without a blur (back gesture, a route change from code) used to cancel
  // the timer and drop the last 1.5 s of typing.
  const unsavedRef = useRef<string | null>(null);
  const persistRef = useRef(persistNote);
  useEffect(() => {
    persistRef.current = persistNote;
  }, [persistNote]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setDraft(value);
      draftRef.current = value;
      setShowSaved(false);
      setSaveFailed(false);
      unsavedRef.current = value;
      clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        unsavedRef.current = null;
        persistNote(value);
      }, 1500);
    },
    [persistNote]
  );

  const handleBlur = useCallback(() => {
    clearTimeout(debounceTimer.current);
    unsavedRef.current = null;
    persistNote(draft);
  }, [draft, persistNote]);

  useEffect(() => {
    return () => {
      clearTimeout(debounceTimer.current);
      if (unsavedRef.current !== null) {
        persistRef.current(unsavedRef.current);
      }
    };
  }, []);

  // The title sits on paper like every other section title, and the
  // white box holds only the field. The cream tint with its own frame made
  // the note the one box of the screen that looked like another component.
  const header = (status?: ReactNode) => (
    <div className={styles.noteHeader}>
      <h2 className={styles.sectionTitle} data-app-section-title=''>
        {copy.title}
      </h2>
      {status}
    </div>
  );

  if (isLoading) {
    // The skeleton has the final box (title line + field), so the
    // note arriving on a slow connection moves nothing.
    return (
      <section className={styles.section}>
        {header()}
        <div className={styles.field}>
          <SkeletonAtom variant='text' width='60%' />
        </div>
      </section>
    );
  }

  if (loadFailed) {
    return (
      <section className={styles.section}>
        {header()}
        <ErrorStateMolecule
          message={tNote('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={retryLoad}
          isRetrying={isRetrying}
        />
      </section>
    );
  }

  return (
    <section className={styles.section}>
      {header()}
      <div className={styles.field}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={draft}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-label={copy.title}
          placeholder={copy.placeholder}
          maxLength={VALIDATION_LENGTHS.DASHBOARD_NOTE_MAX}
          rows={1}
        />
      </div>
      {/* Who sees the notes and when they save stands right UNDER the field. As
          the placeholder, the same sentence filled the white box and a first-
          contact reader took the field for an information card.
          The save line comes after it: its reserved, mostly empty row then ends
          the section instead of opening a hole between the field and the hint. */}
      <p className={styles.hint}>{copy.hint}</p>
      <CompletionLineMolecule
        state={
          queuePending || isSaving
            ? 'pending'
            : saveFailed
              ? 'error'
              : showSaved
                ? 'complete'
                : (draft.trim() || null) !== lastSavedValue.current
                  ? 'dirty'
                  : 'idle'
        }
        message={
          queuePending || isSaving
            ? tOutcome('savePending')
            : saveFailed
              ? tOutcome('saveFailed')
              : showSaved
                ? tOutcome('saveDone')
                : (draft.trim() || null) !== lastSavedValue.current
                  ? tOutcome('saveDirty')
                  : ''
        }
        reserveMessage={tOutcome('saveFailed')}
      />
    </section>
  );
}
