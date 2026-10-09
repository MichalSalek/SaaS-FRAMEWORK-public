// UI/features/client-card/ClientCardPage.confirm-delete.molecule.tsx
// The one „are you sure” dialog of the client card: deleting the note, a
// manual visit or a result photo. It stays open while the request runs and
// after a failure (so the stylist can try again); the caller closes it on
// success.

import { TrashIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';

export function ConfirmDeleteDialogMolecule({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  /** Rendered as the dialog description, so a screen reader announces that
   *  the deletion cannot be undone. */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AppDialogAtom
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && !busy) {
          onClose();
        }
      }}
      disablePointerDismissal={busy}>
      <AppDialogAtom.Content title={title} description={body}>
        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={onClose}
            disabled={busy}>
            {cancelLabel}
          </ButtonAtom>
          <ButtonAtom
            variant='danger'
            size='md'
            icon={<TrashIcon size={16} />}
            onClick={onConfirm}
            loading={busy}>
            {confirmLabel}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
