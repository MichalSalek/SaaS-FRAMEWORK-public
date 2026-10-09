// admin/components/AdminConfirmDeleteDialog.molecule.tsx
// The one "delete this record?" confirmation of the admin editors (policies,
// announcements, colours, traits). Four pages carried four copies with four
// button recipes; copy stays with the caller.

import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';

interface AdminConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  /** What exactly disappears, with the record's name. */
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AdminConfirmDeleteDialogMolecule({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  isDeleting,
  onConfirm,
  onCancel,
}: AdminConfirmDeleteDialogProps) {
  return (
    <AppDialogAtom
      open={open}
      onOpenChange={next => {
        // Held open until the delete settles: the wait shows in the button,
        // and the result refers to the record named here.
        if (!next && !isDeleting) {
          onCancel();
        }
      }}
      disablePointerDismissal>
      <AppDialogAtom.Content
        title={title}
        description={message}
        closeDisabled={isDeleting}>
        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={onCancel}
            disabled={isDeleting}>
            {cancelLabel}
          </ButtonAtom>
          <ButtonAtom
            variant='danger'
            size='md'
            onClick={onConfirm}
            loading={isDeleting}>
            {confirmLabel}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
