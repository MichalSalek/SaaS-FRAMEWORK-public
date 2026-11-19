import type { UiLibraryEntryMeta } from './uiLibrary.types';

/** Human descriptions are resolved from the reviewed shared locale namespace. */
export const FEEDBACK_ENTRIES = {
  completionLine: {
    id: 'completion-line',
    name: 'CompletionLine (L1)',
    importPath: 'src/UI/components/OutcomeFeedback/CompletionLine.molecule',
    status: 'DRAFT',
    whenToUse: 'libraryCompletionWhen',
  },
  outcomeState: {
    id: 'outcome-state',
    name: 'OutcomeState (L2)',
    importPath: 'src/UI/components/OutcomeFeedback/OutcomeState.molecule',
    status: 'DRAFT',
    whenToUse: 'libraryStateWhen',
  },
  snackbarMessage: {
    id: 'outcome-toast',
    name: 'SnackbarMessage (L3)',
    importPath:
      'src/application/app-snackbar/sonner-adapter/SnackbarMessage.molecule',
    status: 'DRAFT',
    whenToUse: 'libraryToastWhen',
  },
  successScene: {
    id: 'success-scene',
    name: 'SuccessScene (L4)',
    importPath: 'src/UI/components/OutcomeFeedback/SuccessScene.organism',
    status: 'DRAFT',
    whenToUse: 'librarySceneWhen',
  },
} satisfies Record<string, UiLibraryEntryMeta>;
