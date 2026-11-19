import { useTranslations } from 'next-intl';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { isIOError } from '../../../application/http/io';
import { ButtonAtom } from '../../components/Button/Button.atom';
import type { PairingAudience } from '../shared/pairing/pairingAudience';
import { useSwitchRole } from '../shared/hooks/useSwitchRole';

/** Switching changes mode only; the client explicitly requests after access resolves. */
export function StylistProfileRoleActionMolecule({
  audience,
  onRequestPair,
}: {
  audience: PairingAudience;
  onRequestPair: () => void;
}) {
  const t = useTranslations('stylist.actions');
  const switchRole = useSwitchRole();
  if (audience === 'stylistNoClient') {
    return (
      <ButtonAtom variant='primary' size='md' onClick={onRequestPair}>
        {t('createClientAccount')}
      </ButtonAtom>
    );
  }
  if (audience !== 'stylistWithClient') {
    return null;
  }
  return (
    <>
      <ButtonAtom
        variant='primary'
        size='md'
        disabled={switchRole.isPending}
        aria-busy={switchRole.isPending}
        onClick={() =>
          switchRole.mutate({ account_type: AccountTypeValue.CLIENT })
        }>
        {t('switchToClient')}
      </ButtonAtom>
      {switchRole.isError && !isIOError(switchRole.error) && (
        <p role='alert'>{t('switchToClientError')}</p>
      )}
    </>
  );
}
