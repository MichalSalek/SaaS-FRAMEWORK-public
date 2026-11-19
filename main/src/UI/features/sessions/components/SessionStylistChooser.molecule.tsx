// UI/features/sessions/components/SessionStylistChooser.molecule.tsx
// A session that has no stylist yet: where its photos will come from.
//
// DECISION: (1) a session gets its stylist only with the first photo (the backend locks it to the
// photo's author, `session-container-add-photo.operation`), so a fresh draft created by "Utwórz
// sesję" had neither photos nor a stylist and the screen said only "add at least one style" with no
// way forward; a session with photos but no stylist showed a share button that ended in an error.
// Here the client chooses a gallery: the row leads to the stylist's gallery in add-to-THIS-session
// mode. With no connected stylists the only path is connecting. (2) A stylist with whom the client
// already has ANOTHER open session (a draft counts, index `session_container_active_pair_uq`)
// cannot get this one: the first photo ended in a refusal. She stays visible in a second group,
// under the same caption as in the "Utwórz sesję" dialog, and her row leads to the session that is
// already open (`session-stylist-availability.ts`). When the sessions list is absent (loading or
// failed) all stylists are selectable and the backend names the collision anyway
// (SESSION_CONTAINER_PAIR_SESSION_EXISTS).

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { QrCodeIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import type { PairedStylistView } from '../../shared/pairing/hooks/usePairedStylists';
import {
  flattenClientSessionPages,
  useClientSessions,
} from '../hooks/useClientSessions';
import {
  mapOpenSessionsByStylist,
  splitStylistsByOpenSession,
} from '../session-stylist-availability';

export function SessionStylistChooserMolecule({
  sessionId,
  pairs,
}: {
  sessionId: string;
  pairs: readonly PairedStylistView[];
}) {
  const t = useTranslations('pages.sessions');
  const tCreate = useTranslations('createSession');
  const { data: sessionPages } = useClientSessions();
  const { available, withOpenSession } = useMemo(
    () =>
      splitStylistsByOpenSession(
        pairs.filter(pair => !pair.isInactive),
        mapOpenSessionsByStylist(
          flattenClientSessionPages(sessionPages),
          sessionId
        )
      ),
    [pairs, sessionPages, sessionId]
  );
  const nameOf = (stylist: PairedStylistView) =>
    stylist.stylistDisplayName || t('chooseStylistFallbackName');
  const avatarOf = (stylist: PairedStylistView) => (
    <AvatarAtom
      name={nameOf(stylist)}
      src={stylist.avatarUrl ?? undefined}
      size='md'
      decorative
    />
  );

  if (available.length === 0 && withOpenSession.length === 0) {
    return (
      <EmptyStateAtom
        size='panel'
        icon={<QrCodeIcon size={32} weight='duotone' />}
        title={t('chooseStylistNoneTitle')}
        titleAs='h2'
        action={
          <LinkButtonAtom
            variant='primary'
            size='lg'
            href={ROUTES_FRONT.PAIRING}>
            {t('chooseStylistNoneCta')}
          </LinkButtonAtom>
        }
      />
    );
  }

  return (
    <>
      {available.length > 0 && (
        <NavRowListMolecule
          label={t('chooseStylistTitle')}
          ariaLabel={t('chooseStylistTitle')}>
          {available.map(stylist => (
            <NavRowMolecule
              key={stylist.stylistAccountId}
              href={`${buildRoute(ROUTES_FRONT.STYLIST_GALLERY, { id: stylist.stylistAccountId })}?addToSession=${sessionId}`}
              leading={avatarOf(stylist)}
              label={nameOf(stylist)}
              description={t('chooseStylistRowHint')}
              trailing='disc'
            />
          ))}
        </NavRowListMolecule>
      )}
      {withOpenSession.length > 0 && (
        <NavRowListMolecule label={tCreate('openSessionsLabel')}>
          {withOpenSession.map(({ stylist, sessionId: openSessionId }) => (
            <NavRowMolecule
              key={stylist.stylistAccountId}
              href={buildRoute(ROUTES_FRONT.CLIENT_SESSION_DETAIL, {
                sessionId: openSessionId,
              })}
              leading={avatarOf(stylist)}
              label={nameOf(stylist)}
              description={tCreate('openSessionRowHint')}
              trailing='disc'
            />
          ))}
        </NavRowListMolecule>
      )}
    </>
  );
}
