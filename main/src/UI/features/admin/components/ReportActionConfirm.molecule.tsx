// admin/components/ReportActionConfirm.molecule.tsx
// Confirmation of a destructive moderation action (HIDE / DELETE / BAN) on the
// shared dialog. WARN, DISMISS and STRIKE are benign and fire without it.

import { useTranslations } from 'next-intl';
import type { ModerationAction as ModerationActionType } from '@kernel/models/moderation/moderation.dto';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';

// Only destructive actions are routed through this step. The prop type carries
// that contract, so the maps stay exhaustive over what can actually be staged
// and no dead i18n entries are needed for the never-confirmed actions.
export type ConfirmableModerationAction = Extract<
  ModerationActionType,
  'HIDE' | 'DELETE' | 'BAN'
>;

const TITLE_KEY: Record<ConfirmableModerationAction, string> = {
  HIDE: 'confirmHideTitle',
  DELETE: 'confirmDeleteTitle',
  BAN: 'confirmBanTitle',
};

const MESSAGE_KEY: Record<ConfirmableModerationAction, string> = {
  HIDE: 'confirmHideMessage',
  DELETE: 'confirmDeleteMessage',
  BAN: 'confirmBanMessage',
};

const CTA_KEY: Record<ConfirmableModerationAction, string> = {
  HIDE: 'confirmHideCta',
  DELETE: 'confirmDeleteCta',
  BAN: 'confirmBanCta',
};

// DECISION: the confirmation stands on the shared dialog like every other confirmation in the panel
// (it used to be a custom alertdialog inside the card with its own focus trap, pink background and
// two hand-made buttons). The dialog stays open while the request runs: the result shows in the
// button, not in a card that may have changed underneath.
export function ReportActionConfirmMolecule({
  action,
  inProgress,
  onConfirm,
  onCancel,
}: {
  /** null = closed. The last staged action stays rendered while it closes. */
  action: ConfirmableModerationAction | null;
  inProgress: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('admin.moderation');
  return (
    <AppDialogAtom
      open={action !== null}
      onOpenChange={open => {
        if (!open && !inProgress) {
          onCancel();
        }
      }}>
      {action !== null && (
        <AppDialogAtom.Content
          title={t(TITLE_KEY[action])}
          description={t(MESSAGE_KEY[action])}
          closeDisabled={inProgress}>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='outlined'
              onClick={onCancel}
              disabled={inProgress}>
              {t('confirmCancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='danger'
              loading={inProgress}
              onClick={onConfirm}>
              {t(CTA_KEY[action])}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      )}
    </AppDialogAtom>
  );
}
