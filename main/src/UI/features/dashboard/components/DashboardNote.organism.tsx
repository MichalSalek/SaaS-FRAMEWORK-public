import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon } from '@phosphor-icons/react';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { useDashboardNote } from '../hooks/useDashboardNote';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import styles from './DashboardNote.module.css';
import pageStyles from '../DashboardPage.module.css';

interface DashboardNoteProps {
  accountType: AccountType;
}

export function DashboardNoteOrganism({ accountType }: DashboardNoteProps) {
  const t = useTranslations('pages.app');
  const tNote = useTranslations('dashboard.note');
  const tButtons = useTranslations('buttons');
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const showSavedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const lastSavedValue = useRef<string | null>(null);
  // Zapisy SZEREGOWANE (łańcuch promise) i generacja: debounce + blur potrafiły
  // wysłać A i B równolegle, B kończyło się pierwsze, A nadpisywało serwer, a
  // UI trzymało B jako „zapisane". Sukces liczy się tylko dla najnowszej
  // generacji; błąd cofa dedup, żeby kolejny blur mógł ponowić.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveGenRef = useRef(0);
  const lastQueuedValue = useRef<string | null>(null);

  // Seed the draft only from a note that was actually READ (see loadFailed).
  useEffect(() => {
    if (!isLoading && !loadFailed && !initialized.current) {
      setDraft(note ?? '');
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
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [draft, autoGrow]);

  // „Zapisano" i dedup po wartości dopiero po POTWIERDZONYM zapisie. Wcześniej
  // ref lastSavedValue był ustawiany przed wysyłką, więc po błędzie sieci
  // identyczna treść była już „zapisana" (kolejny blur = no-op), pasek pokazywał
  // check, a po odświeżeniu wracała stara notatka z serwera — cicha utrata.
  const persistNote = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const newValue = trimmed === '' ? null : trimmed;
      if (newValue === lastQueuedValue.current) {
        return;
      }
      lastQueuedValue.current = newValue;
      const gen = ++saveGenRef.current;
      saveChainRef.current = saveChainRef.current
        .then(() => saveNoteAsync(newValue))
        .then(() => {
          lastSavedValue.current = newValue;
          if (gen !== saveGenRef.current) {
            return;
          }
          setShowSaved(true);
          clearTimeout(showSavedTimer.current);
          showSavedTimer.current = setTimeout(() => setShowSaved(false), 2000);
        })
        .catch(() => {
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
      clearTimeout(showSavedTimer.current);
      if (unsavedRef.current !== null) {
        persistRef.current(unsavedRef.current);
      }
    };
  }, []);

  // S126: the title sits on paper like every other section title, and the
  // white box holds only the field. The cream tint with its own frame made
  // the note the one box of the screen that looked like another component.
  const header = (status?: ReactNode) => (
    <div className={styles.noteHeader}>
      <h2 className={pageStyles.sectionTitle}>{t('dashboardNote.title')}</h2>
      {status}
    </div>
  );

  if (isLoading) {
    // DD3-D4: the skeleton has the final box (title line + field), so the
    // note arriving on a slow connection moves nothing.
    return (
      <section className={pageStyles.section}>
        {header()}
        <div className={styles.field}>
          <SkeletonAtom variant='text' width='60%' />
        </div>
      </section>
    );
  }

  if (loadFailed) {
    return (
      <section className={pageStyles.section}>
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
    <section className={pageStyles.section}>
      {header(
        // Always mounted: the status appearing must not move the title row.
        <span className={styles.status} aria-live='polite'>
          {isSaving ? (
            tNote('saving')
          ) : showSaved ? (
            <CheckIcon size={16} aria-hidden='true' />
          ) : null}
        </span>
      )}
      <div className={styles.field}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={draft}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-label={t('dashboardNote.title')}
          placeholder={t('dashboardNote.placeholder')}
          maxLength={VALIDATION_LENGTHS.DASHBOARD_NOTE_MAX}
          rows={1}
        />
      </div>
      {/* Who sees the notes and when they save stands UNDER the field. As the
          placeholder, the same sentence filled the white box and a first-
          contact reader took the field for an information card (2026-10-09). */}
      <p className={styles.hint}>{t('dashboardNote.hint')}</p>
    </section>
  );
}
