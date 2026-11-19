import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
import { SuccessSceneOrganism } from '../../components/OutcomeFeedback/SuccessScene.organism';
import { SnackbarMessageMolecule } from '../../../application/app-snackbar/sonner-adapter/SnackbarMessage.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FEEDBACK_ENTRIES } from './uiLibrary.registry.feedback';
import {
  LibraryEntryComposition,
  LibrarySectionComposition,
} from './UiLibraryEntry.composition';

export function UiLibrarySectionFeedbackOrganism() {
  const t = useTranslations('components.outcomeFeedback');
  const buttons = useTranslations('buttons');
  const [saved, setSaved] = useState(false);
  return (
    <LibrarySectionComposition id='outcome-feedback' title='OutcomeFeedback'>
      <LibraryEntryComposition
        meta={{
          ...FEEDBACK_ENTRIES.completionLine,
          whenToUse: t('libraryCompletionWhen'),
        }}>
        <CompletionLineMolecule
          state={saved ? 'complete' : 'dirty'}
          message={saved ? t('saveDone') : t('saveDirty')}
          reserveMessage={t('saveFailed')}
        />
        <ButtonAtom
          variant='outlined'
          onClick={() => setSaved(value => !value)}>
          {buttons('save')}
        </ButtonAtom>
      </LibraryEntryComposition>
      <LibraryEntryComposition
        meta={{
          ...FEEDBACK_ENTRIES.outcomeState,
          whenToUse: t('libraryStateWhen'),
        }}>
        <OutcomeStateMolecule confirmed message={t('visitAdded')} />
      </LibraryEntryComposition>
      <LibraryEntryComposition
        meta={{
          ...FEEDBACK_ENTRIES.snackbarMessage,
          whenToUse: t('libraryToastWhen'),
        }}>
        <SnackbarMessageMolecule label='' message={t('saveDone')} />
      </LibraryEntryComposition>
      <LibraryEntryComposition
        meta={{
          ...FEEDBACK_ENTRIES.successScene,
          whenToUse: t('librarySceneWhen'),
        }}>
        <SuccessSceneOrganism
          titleAs='h2'
          title={t('sessionCreated')}
          body={t('sessionReady')}
          actions={
            <ButtonAtom variant='outlined'>{buttons('cancel')}</ButtonAtom>
          }
        />
      </LibraryEntryComposition>
    </LibrarySectionComposition>
  );
}
