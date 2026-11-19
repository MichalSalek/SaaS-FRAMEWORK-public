import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { endContact_IO } from '../../../domain/messaging/messagingIO.possibilities.api';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';

export function EndContactDialogMolecule({
  pairId,
  open,
  onOpenChange,
}: {
  pairId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('pages.messaging');
  const buttons = useTranslations('buttons');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => endContact_IO({ pair_id: pairId }),
    onSuccess: async () => {
      trackFlowStep('message', 'contact_ended', { measurement_version: 1 });
      onOpenChange(false);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.thread(pairId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
    },
  });
  return (
    <AppDialogAtom open={open} onOpenChange={onOpenChange}>
      <AppDialogAtom.Content
        title={t('endContactTitle')}
        description={t('endContactDescription')}>
        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}>
            {buttons('cancel')}
          </ButtonAtom>
          <ButtonAtom
            variant='primary'
            size='md'
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}>
            {t('endContact')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
