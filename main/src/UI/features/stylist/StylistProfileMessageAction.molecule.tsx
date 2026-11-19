import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { ChatsCircleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import type { PairingAudience } from '../shared/pairing/pairingAudience';

export function StylistProfileMessageActionMolecule({
  audience,
  pending,
  onContact,
  failed = false,
}: {
  audience: PairingAudience;
  pending: boolean;
  onContact: () => void;
  failed?: boolean;
}) {
  const t = useTranslations('stylist.actions');
  const enabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.PROFILE_MESSAGING_ENABLED
  );
  if (!enabled || audience === 'owner' || audience === 'checking') {
    return null;
  }
  return (
    <div>
      <ButtonAtom
        variant='outlined'
        size='md'
        icon={<ChatsCircleIcon size={16} />}
        disabled={pending}
        onClick={onContact}>
        {t('messageStylist')}
      </ButtonAtom>
      <CompletionLineMolecule
        state={failed ? 'error' : 'idle'}
        message={failed ? t('messageOpenError') : ''}
        reserveMessage={t('messageOpenError')}
      />
    </div>
  );
}
