// UI/features/shared/sessions/SessionRow.molecule.tsx
// One inspiration session as a row of a list, for both roles: the stylist's
// list of sessions from her clients (features/shared) and the client's own
// list (features/sessions). Built ON NavRowMolecule: the look is the
// primitive's, this file only decides what goes into which slot.

import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { NavRowMolecule } from '../../../components/NavRow/NavRow.molecule';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import styles from './SessionRow.module.css';

/** What the status pill shows. Each role resolves it with its own rules and
 *  its own copy (stylist: `resolveSessionStatus`; client: the lifecycle
 *  helpers in ClientSessionsPage.formatters). */
export interface SessionRowStatus {
  label: string;
  /** A CSS colour or custom-property reference, as StatusPillAtom takes it. */
  color: string;
}

export interface SessionRowProps {
  /** The session's detail page of the role that looks at the list. */
  href: string;
  /** Stylist's list: the client's name. Client's list: the session's name.
   *  Never cut: it wraps and the row grows. */
  label: string;
  /** „3 zdjęcia”: one line under the label. */
  photoCountLabel: string;
  status: SessionRowStatus;
  /** The date that belongs to the status (time left for an open session, the
   *  day a finished one ended); `null` for a draft. */
  when: string | null;
  /** Less than a day left: the date is set in full ink and weight. */
  urgent?: boolean;
  /** Stylist's list only: her list is a list of people, so the row leads with
   *  the client's avatar. Omitted on the client's side. */
  avatarName?: string;
  /** Client's list only: the stylist this session is for ('' when unknown:
   *  a draft without a stylist, or she disconnected since). A session is made
   *  for one stylist, and „Udostępniona” alone left the reader asking „to
   *  whom?” (user-eyes review 2026-10-09), so her name leads the second line,
   *  before the photo count. That line is DATA of unknown length (a name), so
   *  on this side it stands in the wrapping `note`, never in the one-line
   *  `description` that would cut it. */
  forStylist?: string | undefined;
}

/* DECISION: the stylist's and the client's session are the SAME row, a NavRowMolecule (the
 * one tappable row of the product). Session state is carried by the pill alone; open and
 * closed sessions differ in nothing else. Add no classes that change the row's look: local
 * CSS covers only the note slot (who line, the unbreakable date). (owner) */
export function SessionRowMolecule({
  href,
  label,
  photoCountLabel,
  status,
  when,
  urgent = false,
  avatarName,
  forStylist,
}: SessionRowProps) {
  const clientSide = forStylist !== undefined;
  const whoAndCount =
    forStylist !== undefined && forStylist !== ''
      ? `${forStylist}, ${photoCountLabel}`
      : photoCountLabel;
  return (
    <NavRowMolecule
      href={href}
      {...(avatarName !== undefined
        ? { leading: <AvatarAtom name={avatarName} size='md' decorative /> }
        : {})}
      label={label}
      {...(clientSide ? {} : { description: photoCountLabel })}
      note={
        <>
          {clientSide && <span className={styles.who}>{whoAndCount}</span>}
          {/* DECISION: no dot in the session status pill. Next to an avatar a
              green „Aktywna” with a dot reads as „online now”, which the app
              never knows. Urgency stays in the bold date. (owner) */}
          <StatusPillAtom
            color={status.color}
            showDot={false}
            label={status.label}
          />
          {when !== null && (
            <span
              className={styles.when}
              data-urgent={urgent ? '' : undefined}
              suppressHydrationWarning>
              {/* The remaining time is computed from Date.now(): server and
                  client can cross a minute boundary during hydration. Dates
                  for finished sessions are stable, so suppressing the text
                  mismatch is safe for both kinds of `when`. (owner) */}
              {when}
            </span>
          )}
        </>
      }
      trailing='disc'
    />
  );
}
