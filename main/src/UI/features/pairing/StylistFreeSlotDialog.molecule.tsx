// Stylist-side "free a slot" for an inactive (soft-deleted / banned) client.
// Trigger + confirm dialog + revoke, optional CRM-note delete after success.
// Isolated so StylistPairedClients stays under the 300 LOC ceiling.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { ToggleAtom } from '../../components/Toggle/Toggle.atom';
import type { PairedClient } from '../../../domain/pairing/pairing.types';
import { useDeleteClientCrmNote } from '../client-card/hooks/useClientCrmNote';
import { useUnpair } from '../shared/pairing/hooks/useUnpair';
import { beginFreeSlotConfirm } from './freeSlotConfirm.guard';
import styles from './PairingPage.module.css';

type TPairing = ReturnType<typeof useTranslations<'pages.pairing'>>;

export function StylistFreeSlotDialogMolecule({
  client,
  t,
}: {
  client: PairedClient;
  t: TPairing;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteNote, setDeleteNote] = useState(false);
  const tButtons = useTranslations('buttons');
  const unpairMutation = useUnpair({
    successMessageKey: 'freeSlotSuccess',
  });
  const deleteNoteMutation = useDeleteClientCrmNote(client.user_id);

  const closeDialog = () => {
    if (unpairMutation.isPending) {
      return;
    }
    setConfirmOpen(false);
    setDeleteNote(false);
  };

  const handleConfirm = () => {
    beginFreeSlotConfirm({
      isPending: unpairMutation.isPending,
      revoke: () => {
        unpairMutation.mutate(
          { target_user_id: client.user_id },
          {
            onSuccess: () => {
              if (deleteNote) {
                deleteNoteMutation.mutate();
              }
              setConfirmOpen(false);
              setDeleteNote(false);
            },
          }
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
              {t('freeSlotBodyStylist')}
            </TypographyAtom>
            <div className={styles.freeSlotDeleteNote}>
              <ToggleAtom
                label={t('freeSlotDeleteNote')}
                checked={deleteNote}
                disabled={unpairMutation.isPending}
                onChange={event => setDeleteNote(event.target.checked)}
              />
            </div>
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
