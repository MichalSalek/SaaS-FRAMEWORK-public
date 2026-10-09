/**
 * Messaging helpers — rezolucja strony pary + gating + mapowanie counterpart.
 *
 * SECURITY: dostęp do rozmowy jest per-PARA. Wołający musi być JEDNĄ ze stron
 * pary (client_user_id == currentUser.id  ALBO  stylist_account_id ==
 * currentUser.stylist_account.account_id). resolvePairSide zwraca null gdy nie
 * jest stroną → operacje mapują to na MESSAGING_PAIR_NOT_FOUND (anti-enumeration).
 */

import type { CurrentUser } from '@kernel/models/user/user.types';
import {
  StylistClientMessageSenderValue,
  type StylistClientMessageSender,
} from '@kernel/models/messaging/messaging.dto';
import {
  PairingStatusValue,
  type PairingStatus,
} from '@kernel/models/db_models.generated.dto';

/** Strona wołającego w danej parze, albo null gdy nie jest stroną. */
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
    status === PairingStatusValue.ACTIVE
  );
}

/** Nazwa drugiej strony z perspektywy wołającego (dla nagłówka/listy). */
export function counterpartName(
  side: StylistClientMessageSender,
  loaded: {
    clientName: string | null;
    clientEmail: string | null;
    /** PENDING/ACTIVE/REVOKED — e-mail fallback TYLKO dla ACTIVE (S82). */
    pairStatus: PairingStatus;
    /** User.is_active klientki — soft-deleted nie wycieka PII (S82). */
    clientIsActive: boolean;
    stylistDisplayName: string | null;
    stylistBusinessName: string | null;
  }
): string {
  if (side === StylistClientMessageSenderValue.STYLIST) {
    // Stylistka rozmawia z KLIENTKĄ. `.trim() ||` zamiast `??` — Prisma
    // default User.name to "" (nie null), więc `??` nigdy nie łapał
    // bezimiennych (klasa S67a).
    // DECISION (nie usuwaj tego komentarza): CAŁE ujawnienie PII klientki jest
    // GATED na loaded.clientIsActive (defense-in-depth, SSOT visibility-cascade:
    // pairing-query.operations.ts). Live-surface-masks: soft-deleted/disabled
    // klientka (para zostaje ACTIVE per Model A) → '' zarówno dla imienia jak i
    // e-mail fallbacku. Wcześniej clientName wyciekał PRZED bramką clientIsActive
    // (zdjęte imię docierało do stylistki mimo intencji tego komentarza) — teraz
    // name też pod bramką. E-mail fallback dodatkowo GATED na parę ACTIVE
    // (closing-review S82): getPendingPairRequests ma jawne PII-minimum "email
    // dopiero po ACCEPT". Para PENDING / zdjęta klientka → '' (UI renderuje
    // neutralne "Rozmowa").
    if (!loaded.clientIsActive) {
      return '';
    }
    const emailFallback =
      loaded.pairStatus === PairingStatusValue.ACTIVE
        ? loaded.clientEmail?.trim()
        : undefined;
    return loaded.clientName?.trim() || emailFallback || '';
  }
  // Klientka rozmawia ze STYLISTKĄ (display_name, fallback business_name).
  // ŚWIADOMIE bez e-mail fallbacku: klientka nigdzie indziej nie dostaje
  // loginowego e-maila stylistki (kierunek PII zamknięty, S82).
  return (
    loaded.stylistDisplayName?.trim() ||
    loaded.stylistBusinessName?.trim() ||
    ''
  );
}
