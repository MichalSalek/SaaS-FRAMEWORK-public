// Stylist rows of the CreateSessionModal pick step. Extracted from the
// organism (max-lines 300). Two groups of rows:
//   - available → tap creates a session (per-row „creating" status),
//   - with an open session → tap opens THAT session (a row whose session id
//     the page does not know is static and says why).
//
// DECISION: the rows are NavRowMolecule, the product's one tappable row. They were bare buttons
// without an arrow disc, and every blocked row repeated one grey italic sentence; the fact is now
// said ONCE, as the label of the second group. At the limit of shared sessions (`atLimit`) only
// stylists reached through a salon stay as available rows (they take no slot); a tap on anyone
// else could only end in the limit error. (owner)

import { useTranslations } from 'next-intl';
import { AvatarAtom } from '../Avatar/Avatar.atom';
import { NavRowListMolecule, NavRowMolecule } from '../NavRow/NavRow.molecule';
import type { StylistOption } from './CreateSessionModal.types';

function avatarOf(stylist: StylistOption) {
  return (
    <AvatarAtom
      src={stylist.avatarUrl ?? undefined}
      name={stylist.name}
      size='md'
      decorative
    />
  );
}

export function StylistPickRowsMolecule({
  stylists,
  submitting,
  pendingStylistId,
  atLimit,
  blockedByLimit,
  onPick,
  onOpenSession,
}: {
  stylists: StylistOption[];
  submitting: boolean;
  pendingStylistId: string | null;
  /** The client already holds the maximum of shared sessions: nothing new
   *  can be started until one of them is closed. */
  atLimit: boolean;
  /** At the limit with nobody left to pick (no salon stylist outside it). */
  blockedByLimit: boolean;
  onPick: (stylistId: string) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const t = useTranslations('createSession');
  const available = stylists.filter(
    s => !s.hasActiveSession && (!atLimit || s.outsideLimit === true)
  );
  // At the limit only the SHARED sessions are listed: closing one of them is
  // what frees a place (a draft does not count, and a reader who saw four
  // rows under „masz już 3” could not make the numbers agree).
  const withSession = stylists.filter(
    s =>
      s.hasActiveSession && (!blockedByLimit || s.activeSessionShared === true)
  );

  return (
    <>
      {available.length > 0 && (
        <NavRowListMolecule ariaLabel={t('title')}>
          {available.map(s => (
            <NavRowMolecule
              key={s.id}
              // The organism ignores a second pick while one is in flight.
              onClick={() => onPick(s.id)}
              leading={avatarOf(s)}
              label={s.name}
              {...(s.businessName ? { description: s.businessName } : {})}
              {...(pendingStylistId === s.id
                ? { note: <span role='status'>{t('creating')}</span> }
                : {})}
              trailing='disc'
            />
          ))}
        </NavRowListMolecule>
      )}
      {withSession.length > 0 && (
        <NavRowListMolecule
          label={t(blockedByLimit ? 'limitRowsLabel' : 'openSessionsLabel')}>
          {withSession.map(s => {
            const sessionId = s.activeSessionId;
            const canOpen =
              sessionId !== null &&
              sessionId !== undefined &&
              onOpenSession !== undefined &&
              !submitting;
            return (
              <NavRowMolecule
                key={s.id}
                {...(canOpen
                  ? { onClick: () => onOpenSession(sessionId) }
                  : {})}
                leading={avatarOf(s)}
                label={s.name}
                {...(blockedByLimit
                  ? {}
                  : { description: t('openSessionRowHint') })}
                trailing='disc'
              />
            );
          })}
        </NavRowListMolecule>
      )}
    </>
  );
}
