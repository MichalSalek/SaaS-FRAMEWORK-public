import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../../components/Button/Button.atom';
import type { NoteConflictState, NoteRevision } from '../hooks/useNoteConflict';

export function NoteConflictMolecule({
  state,
  draft,
  saving,
  onRefresh,
  onUseStored,
  onOverwrite,
}: {
  state: NoteConflictState;
  draft: string;
  saving: boolean;
  onRefresh: () => void;
  onUseStored: (value: NoteRevision) => void;
  onOverwrite: (revision: string | null) => void;
}) {
  const t = useTranslations('clientCard.noteConflict');
  return (
    <section role='alert' aria-label={t('title')}>
      <h3>{t('title')}</h3>
      <p>{t('description')}</p>
      {state.status === 'loading' ? (
        <p role='status'>{t('loading')}</p>
      ) : state.status === 'failed' ? (
        <>
          <p>{t('loadError')}</p>
          <ButtonAtom variant='outlined' onClick={onRefresh}>
            {t('retryLoad')}
          </ButtonAtom>
        </>
      ) : (
        <>
          <p>
            <strong>{t('stored')}</strong>
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>
            {state.current.note || t('empty')}
          </p>
          <p>
            <strong>{t('draft')}</strong>
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{draft || t('empty')}</p>
          <ButtonAtom
            variant='outlined'
            disabled={saving}
            onMouseDown={event => event.preventDefault()}
            onClick={() => onUseStored(state.current)}>
            {t('useStored')}
          </ButtonAtom>
          <ButtonAtom
            variant='outlined'
            disabled={saving}
            onMouseDown={event => event.preventDefault()}
            onClick={() => onOverwrite(state.current.updatedAt)}>
            {t('overwrite')}
          </ButtonAtom>
        </>
      )}
    </section>
  );
}
