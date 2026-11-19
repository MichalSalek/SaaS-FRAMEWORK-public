// admin/components/UsersTileScope.molecule.tsx
// Scope chips of the users list when a dashboard tile opened it: „new
// accounts” (`?from=<day>`) and „blocked accounts” (`?blocked=1`). Each chip
// names the scope in words; removing it is the way back to the whole list.
// No count beside them: the tile the admin tapped already said it, and the
// cursor-paginated list returns no total.

import { useTranslations } from 'next-intl';
import { formatDate } from '../../../../application/date/date.utils';
import { utcDayStart } from '@kernel/domain/admin/admin-users-url.config';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { AdminScopeChipMolecule } from './AdminScopeChip.molecule';

export function UsersTileScopeMolecule({
  registeredFrom,
  blocked,
  onRemoveRegisteredFrom,
  onRemoveBlocked,
}: {
  registeredFrom: string | null;
  blocked: boolean;
  onRemoveRegisteredFrom: () => void;
  onRemoveBlocked: () => void;
}) {
  const t = useTranslations('admin.users');
  const lang = useCurrentLang();

  return (
    <>
      {registeredFrom !== null && (
        <AdminScopeChipMolecule
          label={t('scopeRegisteredFrom', {
            date: formatDate(utcDayStart(registeredFrom), lang, registeredFrom),
          })}
          countLabel={null}
          onRemove={onRemoveRegisteredFrom}
        />
      )}
      {blocked && (
        <AdminScopeChipMolecule
          label={t('scopeBlocked')}
          countLabel={null}
          onRemove={onRemoveBlocked}
        />
      )}
    </>
  );
}
