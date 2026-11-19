import { SalonContactDialogOrganism } from '../../messaging/SalonContactDialog.organism';
// UI/features/shared/pairing/ClientStylistRowMenu.molecule.tsx
// The „more” menu of a connected stylist's row, on the client's side: her
// gallery, a message, and disconnecting (with a confirmation).
//
// DECISION: a client must be able to take a stylist's access back in the app, so every connected
// stylist's row carries this menu, the mirror of the stylist's client rows: one second control in
// words, disconnecting behind a confirmation. Before, „Rozłącz” existed only in the limit dialog.
// (owner)
//
// Shared by the pairing screen and the client's profile, so it reads its own
// copy (`pages.pairing`) instead of taking the caller's `t`.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LinkBreakIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { AppMenuAtom } from '../../../primitives/AppMenu.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useNativeRouter } from '../../../layouts/useNativeRouter';
import { useUnpair } from './hooks/useUnpair';

interface ClientStylistRowMenuProps {
  /** ClientStylistPair.id: the key of the message thread. */
  pairId: string | null;
  stylistAccountId: string;
  /** Display name already resolved by the row (fallback included). */
  stylistName: string;
}

export function ClientStylistRowMenuMolecule({
  pairId,
  stylistAccountId,
  stylistName,
}: ClientStylistRowMenuProps) {
  const t = useTranslations('pages.pairing');
  const tButtons = useTranslations('buttons');
  const router = useNativeRouter();
  const [unpairOpen, setUnpairOpen] = useState(false);
  const unpairMutation = useUnpair();

  const [contactOpen, setContactOpen] = useState(false);
  const handleDisconnect = () => {
    // In-flight guard: the dialog closes only in onSuccess, so a double tap
    // would fire two revoke POSTs and two toasts.
    if (unpairMutation.isPending) {
      return;
    }
    unpairMutation.mutate(
      { target_account_id: stylistAccountId },
      { onSuccess: () => setUnpairOpen(false) }
    );
  };

  return (
    <>
      <SalonContactDialogOrganism
        target={
          contactOpen
            ? { account_id: stylistAccountId, name: stylistName }
            : null
        }
        onClose={() => setContactOpen(false)}
      />
      <AppMenuAtom>
        <AppMenuAtom.MoreTrigger
          label={t('clientRowMenu', { name: stylistName })}
        />
        <AppMenuAtom.Content align='end'>
          <AppMenuAtom.Item
            onClick={() =>
              router.push(
                buildRoute(ROUTES_FRONT.STYLIST_GALLERY, {
                  id: stylistAccountId,
                })
              )
            }>
            {t('stylistGalleryAction')}
          </AppMenuAtom.Item>
          <AppMenuAtom.Item
            onClick={() => {
              if (pairId) {
                router.push(
                  buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId })
                );
              } else {
                setContactOpen(true);
              }
            }}>
            {t('messageClient')}
          </AppMenuAtom.Item>
          {pairId && (
            <AppMenuAtom.Item tone='danger' onClick={() => setUnpairOpen(true)}>
              {t('unpairBtn')}
            </AppMenuAtom.Item>
          )}
        </AppMenuAtom.Content>
      </AppMenuAtom>

      <AppDialogAtom
        open={unpairOpen}
        onOpenChange={next => {
          // No dismissal (ESC, swipe) while the revoke is in flight: the
          // dialog closes itself on success.
          if (!next && !unpairMutation.isPending) {
            setUnpairOpen(false);
          }
        }}
        disablePointerDismissal={unpairMutation.isPending}>
        <AppDialogAtom.Content
          title={t('clientUnpairTitle')}
          closeDisabled={unpairMutation.isPending}>
          <AppDialogAtom.Body>
            <TypographyAtom variant='body2'>
              {t('clientUnpairBody', { name: stylistName })}
            </TypographyAtom>
          </AppDialogAtom.Body>
          <AppDialogAtom.Actions>
            <ButtonAtom
              variant='text'
              size='md'
              onClick={() => setUnpairOpen(false)}
              disabled={unpairMutation.isPending}>
              {tButtons('cancel')}
            </ButtonAtom>
            <ButtonAtom
              variant='primary'
              size='md'
              icon={<LinkBreakIcon size={16} weight='regular' />}
              onClick={handleDisconnect}
              aria-busy={unpairMutation.isPending}
              disabled={unpairMutation.isPending}>
              {t('unpairBtn')}
            </ButtonAtom>
          </AppDialogAtom.Actions>
        </AppDialogAtom.Content>
      </AppDialogAtom>
    </>
  );
}
