// UI/features/pairing/StylistUnpairDialog.molecule.tsx
// Stylist-side "disconnect a client" confirmation + revoke-access mutation.
// The trigger lives in the „more” menu of the client row, so this dialog is
// controlled by the row; the destructive flow stays in one place.
//
// Backend (pairing/revoke-access) is role-aware: a stylist revokes a client by
// `target_user_id`. Cascade (closes open sessions, drops non-pinned favorites)
// is mirrored by useUnpair query invalidation. Stack: TQ v5 + Base UI dialog.

import { useTranslations } from 'next-intl';
import { LinkBreakIcon } from '@phosphor-icons/react';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import type { PairedClient } from '../../../domain/pairing/pairing.types';
import { useUnpair } from '../shared/pairing/hooks/useUnpair';

type TPairing = ReturnType<typeof useTranslations<'pages.pairing'>>;

export function StylistUnpairDialogMolecule({
  client,
  clientName,
  t,
  open,
  onOpenChange,
}: {
  client: PairedClient;
  /** Display name already resolved by the row (anonymous fallback included). */
  clientName: string;
  t: TPairing;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const tButtons = useTranslations('buttons');
  const unpairMutation = useUnpair({
    successMessageKey: 'stylistUnpairSuccess',
  });

  const handleDisconnect = () => {
    // In-flight guard: dialog closes only in onSuccess (after round-trip), so
    // without this a double-click fires two revoke POSTs — the second hits an
    // already-revoked pair and toasts an error after a successful disconnect.
    if (unpairMutation.isPending) {
      return;
    }
    unpairMutation.mutate(
      { target_user_id: client.user_id },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={next => {
        // Same rule as the buttons below: no dismissal (ESC, swipe) while the
        // revoke is in flight — the dialog closes itself on success.
        if (!next && !unpairMutation.isPending) {
          onOpenChange(false);
        }
      }}
      disablePointerDismissal={unpairMutation.isPending}>
      <AppDialogAtom.Content
        title={t('stylistUnpairTitle')}
        closeDisabled={unpairMutation.isPending}>
        <AppDialogAtom.Body>
          <TypographyAtom variant='body2'>
            {t('stylistUnpairBody', { name: clientName })}
          </TypographyAtom>
        </AppDialogAtom.Body>
        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='text'
            size='md'
            onClick={() => onOpenChange(false)}
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
  );
}
