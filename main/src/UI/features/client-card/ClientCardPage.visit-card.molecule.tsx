import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ImageIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { VisitRecordSourceValue } from '@kernel/models/db_models.generated.dto';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import type { VisitRecordDTO } from '@kernel/models/visit/visit.dto';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ConfirmDeleteDialogMolecule } from './ClientCardPage.confirm-delete.molecule';
import { formatDate } from '../../../application/date/date.utils';
import { useVisitSessionPhotoUrls } from './hooks/useVisitSessionPhotoUrls';
import { useUploadResultPhoto } from './hooks/useUploadResultPhoto';
import {
  PhotoStripMolecule,
  VisitResultPhotosMolecule,
} from './ClientCardPage.visit-photos.molecule';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import styles from './ClientCardPage.module.css';

export function VisitCardMolecule({
  visit,
  clientUserId,
  onUpdateNote,
  onRemovePhoto,
  onDeleteVisit,
}: {
  visit: VisitRecordDTO;
  clientUserId: string;
  /** Each resolves on success and rejects on failure (toast by the http
   *  layer); the card keeps its own per-visit status from the outcome —
   *  the page-level mutations are shared by every card. */
  onUpdateNote: (visitId: string, note: string) => Promise<unknown>;
  onRemovePhoto: (visitId: string, photoId: string) => Promise<unknown>;
  onDeleteVisit: (visitId: string) => Promise<unknown>;
}) {
  const t = useTranslations('clientCard');
  const tButtons = useTranslations('buttons');
  const locale = useLocale();
  // Per-card upload instance: pojedyncza współdzielona mutacja pokazywałaby kafelek
  // "uploading" na WSZYSTKICH kartach naraz i clobberowała refy drafta przy dwóch
  // równoległych uploadach do różnych wizyt. Każda karta trzyma własny stan/refy.
  const uploadMutation = useUploadResultPhoto(clientUserId);
  const serverNote = visit.serviceNote ?? '';
  const [note, setNote] = useState(serverNote);
  const isNoteDirty = note !== serverNote;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const atPhotoCap =
    visit.resultPhotos.length >= VISIT_CONFIG.RESULT_PHOTOS_MAX_PER_VISIT;
  const sessionId =
    visit.source === VisitRecordSourceValue.SESSION
      ? (visit.sessionId ?? '')
      : '';
  const sessionPhotos = useVisitSessionPhotoUrls(sessionId);
  const isManual = visit.source === VisitRecordSourceValue.MANUAL;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Dialog zostaje OTWARTY ze spinnerem do rozstrzygnięcia mutacji (nie zamyka
  // się synchronicznie na klik) — user widzi "usuwanie…" zamiast znikającego
  // dialogu bez feedbacku. Sukces zamyka dialog (a wpis znika z listy); porażka
  // zostawia go otwartego, żeby dało się ponowić — wcześniej zamykał się po
  // KAŻDYM rozstrzygnięciu, a jedynym śladem błędu był znikający toast.
  const [isThisDeleting, setIsThisDeleting] = useState(false);
  // Stan zapisu opisu TEJ wizyty: mutacja na stronie jest wspólna dla kart,
  // więc jej isPending/isError nie mówi, która karta zawiodła.
  const [noteStatus, setNoteStatus] = useState<'idle' | 'saving' | 'failed'>(
    'idle'
  );
  const [removingPhotoIds, setRemovingPhotoIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  // A result photo is deleted for good, so the X asks first (S126).
  const [photoToRemove, setPhotoToRemove] = useState<string | null>(null);

  useEffect(() => {
    if (!isNoteDirty) {
      setNote(serverNote);
    }
  }, [isNoteDirty, serverNote]);

  // Only the LATEST save decides the status: an older save settling after a
  // newer one must not flip „failed" back to fine (or the other way round).
  const noteSaveSeq = useRef(0);
  const saveNote = (value: string) => {
    const seq = ++noteSaveSeq.current;
    setNoteStatus('saving');
    const settle = (status: 'idle' | 'failed') => {
      if (seq === noteSaveSeq.current) {
        setNoteStatus(status);
      }
    };
    onUpdateNote(visit.id, value).then(
      () => settle('idle'),
      () => settle('failed')
    );
  };

  const deleteVisit = () => {
    if (isThisDeleting) {
      return;
    }
    setIsThisDeleting(true);
    onDeleteVisit(visit.id).then(
      () => {
        setIsThisDeleting(false);
        setDeleteDialogOpen(false);
      },
      () => setIsThisDeleting(false)
    );
  };

  const removePhoto = (photoId: string) => {
    setPhotoToRemove(null);
    if (removingPhotoIds.has(photoId)) {
      return;
    }
    setRemovingPhotoIds(prev => new Set(prev).add(photoId));
    const settle = () =>
      setRemovingPhotoIds(prev => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    onRemovePhoto(visit.id, photoId).then(settle, settle);
  };

  const sessionPhotoUrls = sessionPhotos.data ?? [];

  return (
    <article className={styles.visitCard}>
      {/* Date, one quiet line of origin, and ONE trailing control (delete, on
          manual entries only: an entry from a session is an automatic record
          and the backend refuses to delete it). */}
      <header className={styles.visitHeader}>
        <div className={styles.visitHeading}>
          <time className={styles.visitDate}>
            {formatDate(visit.visitDate, locale)}
          </time>
          <p className={styles.visitSource}>
            {visit.source === VisitRecordSourceValue.SESSION
              ? t('sessionSource')
              : t('manualSource')}
          </p>
        </div>
        {isManual && (
          <ButtonAtom
            type='button'
            variant='ghost'
            size='md'
            disabled={isThisDeleting}
            onClick={() => setDeleteDialogOpen(true)}
            ariaLabel={t('deleteVisit')}
            icon={<TrashIcon size={20} />}
          />
        )}
      </header>
      <textarea
        className={styles.visitNote}
        value={note}
        maxLength={VISIT_CONFIG.SERVICE_NOTE_MAX}
        placeholder={t('serviceNotePlaceholder')}
        aria-label={t('serviceNotePlaceholder')}
        onChange={event => setNote(event.target.value)}
        onBlur={() => {
          // While a save is in flight, "equal to the server value" is not
          // "nothing to save": a field edited back to the old text must still go
          // out, or the in-flight value lands as the final one.
          if (isNoteDirty || noteStatus === 'saving') {
            saveNote(note);
          }
        }}
      />
      {noteStatus === 'failed' && isNoteDirty && (
        <p className={styles.noteSaveFailed} role='alert'>
          {t('visitNoteSaveFailed')}
          <ButtonAtom
            type='button'
            variant='outlined'
            size='sm'
            onMouseDown={event => event.preventDefault()}
            onClick={() => saveNote(note)}>
            {tButtons('retry')}
          </ButtonAtom>
        </p>
      )}
      {sessionPhotoUrls.length > 0 && (
        <PhotoStripMolecule
          title={t('inspirationPhotos')}
          urls={sessionPhotoUrls}
          altPrefix={t('inspirationPhotos')}
        />
      )}
      <VisitResultPhotosMolecule
        visit={visit}
        onRemovePhoto={setPhotoToRemove}
        removingPhotoIds={removingPhotoIds}
        uploading={uploadMutation.isPending}
      />
      {/* Adding a photo is a labelled button where the photos are, not an
          unlabelled icon in the header. At the limit the reason replaces it. */}
      {atPhotoCap ? (
        <p className={styles.visitSource}>{t('photoCapReached')}</p>
      ) : (
        <ButtonAtom
          type='button'
          variant='outlined'
          size='sm'
          className={styles.addPhotoBtn}
          disabled={uploadMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
          icon={<UploadSimpleIcon size={18} />}>
          {t('addResultPhoto')}
        </ButtonAtom>
      )}
      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type='file'
        accept='image/*'
        tabIndex={-1}
        aria-hidden='true'
        onChange={event => {
          const file = event.target.files?.[0];
          if (file && !atPhotoCap) {
            uploadMutation.mutate({ visitId: visit.id, file });
          }
          event.target.value = '';
        }}
      />
      {isManual && (
        // Stays open with a spinner until the mutation settles; a failure
        // leaves it open so the stylist can try again.
        <ConfirmDeleteDialogMolecule
          open={deleteDialogOpen}
          title={t('deleteVisitConfirmTitle')}
          body={t('deleteVisitConfirmBody')}
          confirmLabel={t('deleteVisitConfirmYes')}
          cancelLabel={t('deleteVisitConfirmNo')}
          busy={isThisDeleting}
          onConfirm={deleteVisit}
          onClose={() => setDeleteDialogOpen(false)}
        />
      )}
      <ConfirmDeleteDialogMolecule
        open={photoToRemove !== null}
        title={t('removePhotoConfirmTitle')}
        body={t('removePhotoConfirmBody')}
        confirmLabel={t('removePhoto')}
        cancelLabel={t('deleteVisitConfirmNo')}
        busy={false}
        onConfirm={() => {
          if (photoToRemove !== null) {
            removePhoto(photoToRemove);
          }
        }}
        onClose={() => setPhotoToRemove(null)}
      />
    </article>
  );
}

export function EmptyHistory() {
  const t = useTranslations('clientCard');
  return (
    <EmptyStateAtom
      className={styles.emptyHistory}
      icon={<ImageIcon size={28} />}
      title={t('emptyHistoryTitle')}
      description={t('emptyHistoryBody')}
    />
  );
}

export function VisitSkeletons() {
  return (
    <div className={styles.visitList}>
      {[0, 1].map(i => (
        <div key={i} className={styles.visitCard}>
          <SkeletonAtom variant='text' width='40%' height={22} />
          <SkeletonAtom variant='rect' width='100%' height={48} />
          <SkeletonAtom variant='rect' width='60%' height={44} />
        </div>
      ))}
    </div>
  );
}
