// Client-side "free a slot" for an inactive (soft-deleted / banned) stylist.
// Trigger + confirm dialog + revoke. Lives next to the inactive row so the
// list molecule stays a layout concern.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import type { PairedStylist } from '../../../domain/pairing/pairing.types';
import { useUnpair } from '../shared/pairing/hooks/useUnpair';
import { beginFreeSlotConfirm } from './freeSlotConfirm.guard';

type TPairing = ReturnType<typeof useTranslations<'pages.pairing'>>;

export function ClientFreeSlotDialogMolecule({
  stylist,
  t,
}: {
  stylist: PairedStylist;
  t: TPairing;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const tButtons = useTranslations('buttons');
  const unpairMutation = useUnpair({
    successMessageKey: 'freeSlotSuccess',
  });

  const closeDialog = () => {
    if (unpairMutation.isPending) {
      return;
    }
    setConfirmOpen(false);
  };

  const handleConfirm = () => {
    beginFreeSlotConfirm({
      isPending: unpairMutation.isPending,
      revoke: () => {
        unpairMutation.mutate(
          { target_account_id: stylist.account_id },
          { onSuccess: () => setConfirmOpen(false) }
        );
      },
    });
  };

  return (
    <>
      <ButtonAtom
        variant='outlined'
        size='sm'
        onClick={() => setConfirmOpen(true)}>
        {t('freeSlotBtn')}
      </ButtonAtom>

      <AppDialogAtom
        open={confirmOpen}
        onOpenChange={open => {
          if (!open) {
            closeDialog();
          }
        }}
        disablePointerDismissal={unpairMutation.isPending}>
        <AppDialogAtom.Content
          title={t('freeSlotTitle')}
          closeDisabled={unpairMutation.isPending}>
          <AppDialogAtom.Body>
            <TypographyAtom variant='body2'>
              {t('freeSlotBodyClient')}
            </TypographyAtom>
          </AppDialogAtom.Body>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='text'
              size='md'
              onClick={closeDialog}
              disabled={unpairMutation.isPending}>
              {tButtons('cancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              onClick={handleConfirm}
              aria-busy={unpairMutation.isPending}
              disabled={unpairMutation.isPending}>
              {t('freeSlotBtn')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}
