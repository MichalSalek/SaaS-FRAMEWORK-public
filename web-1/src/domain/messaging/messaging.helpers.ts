/**
 * Messaging helpers: which side of the pair the caller is, plus send gating.
 *
 * SECURITY: thread access is per pair. The caller must be one side
 * (client_user_id equals currentUser.id, or stylist_account_id equals
 * currentUser.stylist_account.account_id). resolvePairSide returns null
 * otherwise, and operations map that to MESSAGING_PAIR_NOT_FOUND
 * (anti-enumeration).
 */

import type { CurrentUser } from '@kernel/models/user/user.types';
import {
  StylistClientMessageSenderValue,
  type StylistClientMessageSender,
} from '@kernel/models/messaging/messaging.dto';
import {
  AccountStatusValue,
  type AccountStatus,
  PairingStatusValue,
  type PairingStatus,
} from '@kernel/models/db_models.generated.dto';

/** The caller's side of this pair, or null when the caller is not a side. */
export function resolvePairSide(
  pair: { client_user_id: string; stylist_account_id: string },
  currentUser: CurrentUser
): StylistClientMessageSender | null {
  if (pair.client_user_id === currentUser.id) {
    return StylistClientMessageSenderValue.CLIENT;
  }
  const callerStylistAccountId = currentUser.stylist_account?.account_id;
  if (
    callerStylistAccountId != null &&
    pair.stylist_account_id === callerStylistAccountId
  ) {
    return StylistClientMessageSenderValue.STYLIST;
  }
  return null;
}

/** Wysyłka dozwolona gdy para PENDING/ACTIVE. REVOKED = historia read-only. */
export function canSendToPair(status: PairingStatus): boolean {
  return (
    status === PairingStatusValue.PENDING ||
    status === PairingStatusValue.CONTACT ||
    status === PairingStatusValue.ACTIVE
  );
}

/** Nazwa drugiej strony z perspektywy wołającego (dla nagłówka/listy). */
export function counterpartName(
  side: StylistClientMessageSender,
  loaded: {
    clientName: string | null;
    clientEmail: string | null;
    /** PENDING, ACTIVE or REVOKED. The e-mail fallback applies only to ACTIVE. */
    pairStatus: PairingStatus;
    /** User.is_active of the client. A soft-deleted client does not leak PII. */
    clientIsActive: boolean;
    stylistDisplayName: string | null;
    stylistBusinessName: string | null;
  }
): string {
  if (side === StylistClientMessageSenderValue.STYLIST) {
    // The stylist talks to the CLIENT. `.trim() ||` instead of `??` because Prisma defaults User.name to ""
    // (not null), so `??` never caught nameless users.
    // DECISION: ALL client PII disclosure is gated on loaded.clientIsActive (visibility cascade, SSOT
    // pairing-query.operations.ts): a soft-deleted or disabled client (the pair stays ACTIVE per Model A)
    // yields '' for both name and e-mail fallback; the name used to leak before the gate. The e-mail fallback
    // is additionally gated on an ACTIVE pair, because getPendingPairRequests has an explicit PII minimum
    // (e-mail only after ACCEPT). A PENDING pair or a removed client gives '' (the UI renders a neutral "Rozmowa").
    if (!loaded.clientIsActive) {
      return '';
    }
    const emailFallback =
      loaded.pairStatus === PairingStatusValue.ACTIVE
        ? loaded.clientEmail?.trim()
        : undefined;
    return loaded.clientName?.trim() || emailFallback || '';
  }
  // The client talks to the stylist (display_name, then business_name).
  // No e-mail fallback: the client is not shown the stylist's login e-mail
  // anywhere else. The PII direction stays closed.
  return (
    loaded.stylistDisplayName?.trim() ||
    loaded.stylistBusinessName?.trim() ||
    ''
  );
}

/**
 * DECISION: live-surface counterpart visibility mask (SSOT: pairing-query.operations.ts getMyPairs_IO;
 * mirrored in messaging-query.operations.ts). A removed or soft-deleted counterpart (the pair stays ACTIVE
 * per Model A, DOMAIN_SSOT §13.1) can be the addressee of NO write: neither a send (write into the void,
 * the recipient cannot read it) nor a mark-read (the pair is masked on the read surface, so a watermark
 * write would answer 204 for a ghost pair and 404 for a foreign one: an existence oracle). The verdict is
 * the same as for a non-party (MESSAGING_PAIR_NOT_FOUND). The predicate lives in ONE place because
 * markRead_IO once missed it by copying the gate per operation. Reversible on counterpart re-enable.
 */
export const isCounterpartInactive = (
  side: StylistClientMessageSender,
  pair: {
    client_user: { is_active: boolean } | null;
    stylist_account: {
      account_status: AccountStatus;
      created_by_user: { is_active: boolean };
    } | null;
  }
): boolean =>
  pair.client_user?.is_active !== true ||
  pair.stylist_account?.created_by_user?.is_active !== true ||
  (side === StylistClientMessageSenderValue.CLIENT &&
    pair.stylist_account?.account_status !== AccountStatusValue.ACTIVE);
