import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { contactSalonStylist_IO } from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { buildRoute } from '../../../application/routing/buildRoute';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { flowErrorCode } from '../shared/analytics/flowErrorCode';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ThreadComposerMolecule } from './MessageThreadPage.parts.molecule';
export function SalonContactDialogOrganism({
  target,
  onClose,
}: {
  target: { account_id: string; name: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations('salon.profile');
  const router = useNativeRouter();
  const [content, setContent] = useState('');
  const contact = useMutation({
    mutationFn: () =>
      contactSalonStylist_IO({
        stylist_account_id: target?.account_id ?? '',
        content,
      }),
    onSuccess: response => {
      trackFlowStep('message', 'salon_contacted');
      onClose();
      setContent('');
      router.push(
        buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId: response.pair_id })
      );
    },
    onError: error =>
      trackFlowStep('message', 'failed', {
        origin: 'salon_contact',
        code: flowErrorCode(error),
      }),
  });
  const send = () => {
    if (target && content.trim() && !contact.isPending) {
      contact.mutate();
    }
  };
  return (
    <AppDialogAtom
      open={target !== null}
      onOpenChange={open => {
        if (!open && !contact.isPending) {
          onClose();
          setContent('');
        }
      }}
      disablePointerDismissal={contact.isPending}>
      <AppDialogAtom.Content
        title={t('startMessage', { name: target?.name ?? '' })}
        closeDisabled={contact.isPending}>
        <AppDialogAtom.Body>
          <ThreadComposerMolecule
            content={content}
            onContentChange={setContent}
            onSend={send}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            sendPending={contact.isPending}
            shake={contact.isError}
            onShakeEnd={() => contact.reset()}
          />
        </AppDialogAtom.Body>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
