// UI/features/admin/AdminSupportThreadPage.aside.organism.tsx
// The reading column of a support thread: who wrote (with a door to their
// account), the thread status, and the admin's own notes (a local draft).

import { useState, useEffect, useRef } from 'react';
import type { useTranslations } from 'next-intl';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import { adminUserHref } from '@kernel/domain/admin/admin-users-url.config';
import {
  deleteLocalStorage,
  getLocalStorage,
  setLocalStorage,
} from '../../../application/client-device-storage/local-storage-adapter/localStorage.adapter';
import { adminSupportNotesKey } from '../../../application/client-device-storage/storage-keys.config';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { DisclosureMolecule } from '../../components/Disclosure/Disclosure.molecule';
import { InputAtom } from '../../components/Input/Input.atom';
import { SelectAtom } from '../../components/Select/Select.atom';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import { NOTE_MAX } from './AdminSupportThreadPage.parts.organism';
import type { ThreadIdentity } from './supportIdentity.helpers';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminSupportThreadPage.module.css';

type Translate = ReturnType<typeof useTranslations>;

const STATUSES: readonly SupportThreadStatus[] = ['OPEN', 'RESOLVED', 'CLOSED'];

const STATUS_LABEL_KEY = {
  OPEN: 'statusOpen',
  RESOLVED: 'statusResolved',
  CLOSED: 'statusClosed',
} as const satisfies Record<SupportThreadStatus, string>;

const isStatus = (value: string): value is SupportThreadStatus =>
  (STATUSES as readonly string[]).includes(value);

/* ─── The person and the thread status ─── */

// DECISION (nie usuwaj tego komentarza) — S126: karta osoby powtarzała temat
// (stoi w tytule strony) i status (stoi w nagłówku), a status zmieniało się
// trzema własnymi przyciskami w trzech kolorach. Teraz jeden panel: kto pisze,
// wejście na jej konto i JEDNA kontrolka statusu (pole wyboru: mieści się w
// wąskiej kolumnie w każdym języku). Zapis widać w panelu: pole pokazuje
// wybrany status od razu, czeka zablokowane, a obok tytułu stoi „Zapisywanie”.
export function ThreadPersonOrganism({
  identity,
  status,
  pendingStatus,
  onStatusChange,
  t,
}: {
  identity: ThreadIdentity;
  status: SupportThreadStatus;
  /** The status being saved right now; null when none. */
  pendingStatus: SupportThreadStatus | null;
  onStatusChange: (next: SupportThreadStatus) => void;
  t: Translate;
}) {
  return (
    <AdminPanelMolecule
      title={identity.name}
      // Always mounted: the word appears without moving the title row.
      aside={
        <span role='status'>
          {pendingStatus !== null ? t('statusSaving') : ''}
        </span>
      }
      note={
        <SoftBreakTextAtom className={styles.personEmail}>
          {identity.email}
        </SoftBreakTextAtom>
      }
      {...(identity.knownEmail !== null && {
        footer: (
          <LinkButtonAtom
            size='sm'
            variant='outlined'
            direction='forward'
            href={adminUserHref({ search: identity.knownEmail })}>
            {t('openUserAccount')}
          </LinkButtonAtom>
        ),
      })}>
      <SelectAtom
        label={t('switcherLabel')}
        value={pendingStatus ?? status}
        disabled={pendingStatus !== null}
        onChange={event => {
          const next = event.target.value;
          if (isStatus(next) && next !== status) {
            onStatusChange(next);
          }
        }}
        options={STATUSES.map(value => ({
          value,
          label: t(STATUS_LABEL_KEY[value]),
        }))}
      />
    </AdminPanelMolecule>
  );
}

/* ─── Internal notes (admin-only, localStorage drafts) ─── */

export function InternalNotesOrganism({
  threadId,
  t,
}: {
  threadId: string;
  t: Translate;
}) {
  const storageKey = adminSupportNotesKey(threadId);
  const [note, setNote] = useState('');
  const [savedTick, setSavedTick] = useState(false);

  // Hydrate from localStorage (client-only). Reset on threadId change (the
  // previous thread's draft leaked into the next one) and mark the hydration so
  // the debounced save below does not re-save it and flash „Zapisano" without
  // any edit.
  const skipNextSaveRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    skipNextSaveRef.current = true;
    try {
      setNote(getLocalStorage(storageKey) ?? '');
    } catch {
      // ignore — localStorage might be disabled
      setNote('');
    }
  }, [storageKey]);

  // Debounced save → localStorage
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      try {
        if (note.length === 0) {
          deleteLocalStorage(storageKey);
        } else {
          setLocalStorage(storageKey, note);
          setSavedTick(true);
          window.setTimeout(() => setSavedTick(false), 1500);
        }
      } catch {
        // ignore
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [note, storageKey]);

  return (
    <DisclosureMolecule
      title={t('notesTitle')}
      // Closed, the line says whether a draft waits inside.
      summary={note.length > 0 ? t('notesDraftLocal') : t('notesAdminPill')}>
      <div className={styles.notes}>
        <p className={styles.quiet}>{t('notesHint')}</p>
        <InputAtom
          multiline
          rows={5}
          value={note}
          onChange={event => setNote(event.target.value.slice(0, NOTE_MAX))}
          placeholder={t('notesPlaceholder')}
          aria-label={t('notesAriaLabel')}
        />
        <div className={styles.fieldFooter}>
          <span className={styles.quiet} role='status'>
            {savedTick ? t('notesSaved') : t('notesDraftLocal')}
          </span>
          <span className={styles.counter}>{NOTE_MAX - note.length}</span>
        </div>
      </div>
    </DisclosureMolecule>
  );
}
