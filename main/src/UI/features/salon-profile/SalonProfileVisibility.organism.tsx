import { queryKeys } from '../../../application/http/queryKeys.factory';
import { useId, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  getSalonProfileVisibility_IO,
  updateSalonProfileVisibility_IO,
} from '../../../domain/salon-profile/salonProfileIO.possibilities.api';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { CheckboxAtom } from '../../components/Checkbox/Checkbox.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { traceSalonVisibilityChanged } from './salonProfileFlowTrace';
import { ProfileManageSectionMolecule } from '../shared/profile/ProfileManageSection.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
export function SalonProfileVisibilityOrganism() {
  const t = useTranslations('salon.profile');
  const tOutcome = useTranslations('components.outcomeFeedback');
  const hintId = useId();
  const query = useQuery({
    queryKey: queryKeys.salon.visibility,
    queryFn: ({ signal }) =>
      getSalonProfileVisibility_IO(undefined, { signal }),
  });
  const [visible, setVisible] = useState<boolean | null>(null);
  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      updateSalonProfileVisibility_IO({ visible: next }),
    onSuccess: response => {
      traceSalonVisibilityChanged(response.visible);
      setVisible(response.visible);
    },
    meta: { suppressGlobalError: true },
  });
  if (query.isLoading) {
    return <SkeletonAtom variant='rect' width='100%' height={44} />;
  }
  if (query.isError) {
    return (
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  if (query.data?.visible == null) {
    return null;
  }
  // The membership setting belongs to the team screen, separate from the person's profile.
  return (
    <ProfileManageSectionMolecule title={t('myGalleryVisibility')}>
      <CheckboxAtom
        checked={visible ?? query.data.visible}
        disabled={mutation.isPending}
        label={t('showMe')}
        aria-describedby={hintId}
        onChange={event => mutation.mutate(event.target.checked)}
      />
      <TypographyAtom id={hintId} variant='body2'>
        {t('myGalleryVisibilityHint')}
      </TypographyAtom>
      <CompletionLineMolecule
        state={
          mutation.isPending
            ? 'pending'
            : mutation.isError
              ? 'error'
              : mutation.isSuccess
                ? 'complete'
                : 'idle'
        }
        message={
          mutation.isPending
            ? tOutcome('savePending')
            : mutation.isError
              ? tOutcome('saveFailed')
              : mutation.isSuccess
                ? tOutcome('saveDone')
                : ''
        }
        reserveMessage={tOutcome('saveFailed')}
      />
    </ProfileManageSectionMolecule>
  );
}
