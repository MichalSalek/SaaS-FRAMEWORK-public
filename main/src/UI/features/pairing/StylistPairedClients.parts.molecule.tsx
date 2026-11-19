// Rows of the stylist's client list (active + inactive variants).
//
// DECISION: the client row is NavRowMolecule like every tappable product row (owner).
// Slots: avatar in `leading`, name as label, connection date as description, the
// "more" menu in `end` (a sibling of the link, never inside), what she waits for in `note`.
// The row opens the client card and says so with the arrow disc; the "more" menu holds
// everything else (her session, a message, disconnecting). A row ending with the menu
// alone did not read as tappable (DECISION at the `end` prop of NavRowMolecule).

import { useState } from 'react';
import { useLocale, type useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { PairedClient } from '../../../domain/pairing/pairing.types';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { NavRowMolecule } from '../../components/NavRow/NavRow.molecule';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { AppMenuAtom } from '../../primitives/AppMenu.atom';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { formatDate } from '../../../application/date/date.utils';
import { buildRoute } from '../../../application/routing/buildRoute';
import { StylistUnpairDialogMolecule } from './StylistUnpairDialog.molecule';
import { StylistFreeSlotDialogMolecule } from './StylistFreeSlotDialog.molecule';

type TPairing = ReturnType<typeof useTranslations<'pages.pairing'>>;

/** What one client is waiting for; both zero / false = nothing to show. */
export interface ClientRowAttention {
  unreadMessages: number;
  hasPendingSession: boolean;
  /** Id of her waiting session; '' when there is none or it is unknown. */
  pendingSessionId: string;
}

function InactiveClientRowMolecule({
  client,
  t,
}: {
  client: PairedClient;
  t: TPairing;
}) {
  const locale = useLocale();
  const label = t('inactiveAccount');
  // A static row: nothing to open. It explains itself in a sentence and holds
  // its one action („free the slot”) in the note.
  return (
    <NavRowMolecule
      leading={<AvatarAtom name={label} size='md' decorative />}
      label={label}
      description={t('pairedAt', {
        date: formatDate(client.paired_at, locale),
      })}
      note={
        <>
          <span>{t('inactiveAccountHint')}</span>
          <StylistFreeSlotDialogMolecule client={client} t={t} />
        </>
      }
    />
  );
}

function ActiveClientRowMolecule({
  client,
  attention,
  t,
}: {
  client: PairedClient;
  attention: ClientRowAttention;
  t: TPairing;
}) {
  const [unpairOpen, setUnpairOpen] = useState(false);
  const locale = useLocale();
  const router = useNativeRouter();
  // User['name'] is a non-null string defaulting to '' (nameless magic-link
  // signup), so `??` never falls through — guard the empty string with || .
  const clientName = client.name?.trim() || t('clientAnonymous');
  const cardHref = buildRoute(ROUTES_FRONT.CLIENT_CARD, {
    id: client.user_id,
  });
  const needsHer = attention.hasPendingSession || attention.unreadMessages > 0;

  return (
    <NavRowMolecule
      href={cardHref}
      leading={<AvatarAtom name={clientName} size='md' decorative />}
      label={clientName}
      description={t('pairedAt', {
        date: formatDate(client.paired_at, locale),
      })}
      trailing='disc'
      // In words, never a bare dot: the stylist reads what waits for her. Both
      // are text only (the row is a link, nothing interactive goes inside).
      // DECISION: no leading dot in these pills: a green dot beside a person's name reads as
      // "online now", which the app never knows. The words carry the meaning. (owner)
      {...(needsHer
        ? {
            note: (
              <>
                {attention.hasPendingSession && (
                  <StatusPillAtom
                    color='var(--color-success)'
                    showDot={false}
                    label={t('clientAttentionSession')}
                  />
                )}
                {attention.unreadMessages > 0 && (
                  <StatusPillAtom
                    color='var(--color-accent-fg)'
                    showDot={false}
                    label={t('clientAttentionMessages', {
                      count: attention.unreadMessages,
                    })}
                  />
                )}
              </>
            ),
          }
        : {})}
      end={
        <>
          <AppMenuAtom>
            <AppMenuAtom.MoreTrigger
              label={t('clientRowMenu', { name: clientName })}
            />
            <AppMenuAtom.Content align='end'>
              {/* A client marked „Przysłała zdjęcia”: the menu leads straight
                  into that session (the mark had no door; readers looked for
                  „Zobacz sesję”). */}
              {attention.pendingSessionId !== '' && (
                <AppMenuAtom.Item
                  onClick={() =>
                    router.push(
                      buildRoute(ROUTES_FRONT.SESSION_DETAIL, {
                        sessionId: attention.pendingSessionId,
                      })
                    )
                  }>
                  {t('clientSessionAction')}
                </AppMenuAtom.Item>
              )}
              <AppMenuAtom.Item onClick={() => router.push(cardHref)}>
                {t('clientCardAction')}
              </AppMenuAtom.Item>
              <AppMenuAtom.Item
                onClick={() =>
                  router.push(
                    buildRoute(ROUTES_FRONT.MESSAGES_THREAD, {
                      pairId: client.id,
                    })
                  )
                }>
                {t('messageClient')}
              </AppMenuAtom.Item>
              <AppMenuAtom.Item
                tone='danger'
                onClick={() => setUnpairOpen(true)}>
                {t('unpairBtn')}
              </AppMenuAtom.Item>
            </AppMenuAtom.Content>
          </AppMenuAtom>
          <StylistUnpairDialogMolecule
            client={client}
            clientName={clientName}
            t={t}
            open={unpairOpen}
            onOpenChange={setUnpairOpen}
          />
        </>
      }
    />
  );
}

export function StylistClientRowMolecule({
  client,
  attention,
  t,
}: {
  client: PairedClient;
  attention: ClientRowAttention;
  t: TPairing;
}) {
  if (client.counterpart_inactive) {
    return <InactiveClientRowMolecule client={client} t={t} />;
  }
  return (
    <ActiveClientRowMolecule client={client} attention={attention} t={t} />
  );
}
