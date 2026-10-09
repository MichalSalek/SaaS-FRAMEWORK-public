import { useState } from 'react';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';

export function UiLibraryDialogDemoOrganism() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ButtonAtom variant='outlined' onClick={() => setOpen(true)}>
        Otwórz dialog
      </ButtonAtom>
      <AppDialogAtom open={open} onOpenChange={setOpen}>
        <AppDialogAtom.Content title='Potwierdź działanie'>
          <AppDialogAtom.Body>
            <TypographyAtom variant='body2'>
              Treść ma ten sam odstęp co nagłówek i działania. Na telefonie
              dialog uwzględnia bezpieczny obszar ekranu.
            </TypographyAtom>
          </AppDialogAtom.Body>
          <AppDialogAtom.Actions>
            <ButtonAtom variant='outlined' onClick={() => setOpen(false)}>
              Anuluj
            </ButtonAtom>
            <ButtonAtom onClick={() => setOpen(false)}>Potwierdź</ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}
