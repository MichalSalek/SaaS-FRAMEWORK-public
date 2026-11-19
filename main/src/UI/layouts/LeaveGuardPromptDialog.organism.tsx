// The "leave without saving?" dialog itself, loaded on the first prompt by
// LeaveGuardDialog.composition (DECISION there). Rendering only: the prompt
// state and the router seam live in that host and in leave-guard.ts.

import { useTranslations } from 'next-intl';
import { AppDialogAtom } from '../primitives/AppDialog.atom';
import { ButtonAtom } from '../components/Button/Button.atom';
import {
  resolveLeavePrompt,
  type LeavePrompt,
} from '../../application/routing/leave-guard';

export function LeaveGuardPromptDialogOrganism({
  prompt,
}: {
  prompt: LeavePrompt | null;
}) {
  const t = useTranslations('components.leaveGuard');
  const tButtons = useTranslations('buttons');
  const isDiscard = prompt?.kind === 'discard';

  return (
    <AppDialogAtom
      open={prompt !== null}
      onOpenChange={open => {
        if (!open) {
          resolveLeavePrompt('cancel');
        }
      }}>
      {prompt !== null && (
        <AppDialogAtom.Content
          title={isDiscard ? t('titleDiscard') : t('titleLeave')}
          description={prompt.message}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={() => resolveLeavePrompt('confirm')}>
              {isDiscard ? t('discard') : t('leave')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              onClick={() => resolveLeavePrompt('cancel')}>
              {isDiscard ? tButtons('cancel') : t('stay')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      )}
    </AppDialogAtom>
  );
}
