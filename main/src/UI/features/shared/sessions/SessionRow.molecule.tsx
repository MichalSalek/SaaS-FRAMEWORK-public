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
  pulse: boolean;
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
  /** `when` is the time an OPEN session has left („jeszcze 6 dni”), not a
   *  date. It then stands INSIDE the pill, as one phrase with the status
   *  („Aktywna jeszcze 6 dni”). As two pieces, a pill and a loose text, two
   *  rounds of first-contact readers asked „six days until what?” (2026-10-09).
   *  A finished session keeps its date beside the pill. */
  whenContinuesStatus?: boolean;
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

/* DECISION (nie usuwaj tego komentarza):
 * Sesja u stylistki i u klientki to TEN SAM wiersz (głos ownera `s126-wiersze`,
 * 2026-10-09: NavRowMolecule jest jedynym klikalnym wierszem produktu). Do
 * 2026-10-09 były to dwie lokalne karty po 116px, każda z własnym CSS, w siatce
 * kafli. Stan sesji niesie wyłącznie pigułka; otwarte i zakończone sesje nie
 * różnią się niczym innym. Nie dodawaj tu klas zmieniających wygląd wiersza:
 * jedyny lokalny CSS to data przy statusie (nierozbijalna, pilna pogrubiona)
 * i szkielet o wysokości wiersza. */
export function SessionRowMolecule({
  href,
  label,
  photoCountLabel,
  status,
  when,
  urgent = false,
  whenContinuesStatus = false,
  avatarName,
  forStylist,
}: SessionRowProps) {
  const merged = whenContinuesStatus && when !== null;
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
          <StatusPillAtom
            color={status.color}
            label={merged ? `${status.label} ${when}` : status.label}
            pulse={status.pulse || (merged && urgent)}
          />
          {when !== null && !merged && (
            <span className={styles.when} data-urgent={urgent ? '' : undefined}>
              {when}
            </span>
          )}
        </>
      }
      trailing='disc'
    />
  );
}
