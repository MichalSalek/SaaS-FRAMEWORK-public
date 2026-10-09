import type { Prisma } from '../../prisma/js-client';

import { DB_CLIENT } from '@app/db/db.client';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import type { IDType } from '@kernel/application/application.types';
import { isAccountActive } from '@domain/account/account.config';

/**
 * Per-record visibility gate: may THIS viewer see THIS gallery record?
 *
 * One predicate for every endpoint that takes a gallery_record_id from a logged user
 * (RBAC=LOGGED_USER) and must not act on a record the viewer cannot see: get-by-id
 * (gallery-detail.query.ts) and report-abuse (moderation-report.operation.ts). A caller
 * collapses a `false` into the same GALLERY_RECORD_NOT_FOUND it returns for a
 * nonexistent id, so the gate is never an existence oracle.
 */

/**
 * "Visible pinned records" = exactly what the public profile shows and what the
 * plan's pin quota counts. ONE where-fragment for every pin COUNT (pin gate + its
 * recount, unpin response, dashboard `pinned_count`, usage-stats `pinned_records`)
 * and for the public pinned-gallery read, so the number the owner sees, the number
 * the gate enforces and the works the public sees cannot drift apart. A record
 * hidden by moderation after being pinned stays `is_pinned` in the DB but frees
 * its slot (DECISION in gallery-pin.operations.ts). Spread it into a `where`.
 */
export const VISIBLE_PINNED_GALLERY_RECORD_WHERE = {
  is_pinned: true,
  is_hidden: false,
} as const;

/** Columns the gate reads. Spread into a `select`, or covered by an `include` superset. */
export const GALLERY_RECORD_VISIBILITY_SELECT = {
  is_hidden: true,
  is_pinned: true,
  created_by_account: {
    select: {
      account_id: true,
      created_by_user_id: true,
      account_status: true,
      created_by_user: { select: { is_active: true } },
    },
  },
} as const;

type GalleryRecordVisibilityFacts = Prisma.GalleryRecordGetPayload<{
  select: typeof GALLERY_RECORD_VISIBILITY_SELECT;
}>;

export const isGalleryRecordVisibleToViewer = async (
  record: GalleryRecordVisibilityFacts,
  /** viewerUserId = currentUser.id (User.id from the session) */
  viewerUserId: IDType
): Promise<boolean> => {
  const isOwner = record.created_by_account.created_by_user_id === viewerUserId;

  // OWNER-BYPASS (user-level): the owner still sees her own record when it is hidden,
  // unpinned or her own account is disabled. That is not a leak (she sees only her own)
  // and it keeps the guards below consistent with each other.
  if (isOwner) {
    return true;
  }

  // DECISION (nie usuwaj tego komentarza):
  // Rekordy ukryte przez moderacje (HIDE) lub cala galeria zbanowanego stylisty
  // (BAN ustawia is_hidden=true) NIE moga byc dostepne po ID dla obcych userow —
  // endpoint ma RBAC=LOGGED_USER, wiec bez tego guardu kazdy zalogowany user moglby
  // pobrac asset_url + stylist_info ukrytego rekordu (bypass moderacji). Wlasciciel
  // (isOwner, user-level) NADAL widzi swoj ukryty rekord — to celowe.
  if (record.is_hidden) {
    return false;
  }

  // DECISION (nie usuwaj tego komentarza):
  // Visibility-cascade guard (mirror gallery-explore.query.ts + public-profile):
  // rekordy galerii stylisty z NIEAKTYWNYM kontem (account_status != ACTIVE — np.
  // deactivated/expired) LUB nieaktywnym userem (is_active=false — soft-delete forever,
  // DOMAIN_SSOT §13.1) NIE moga byc pobieralne po ID dla obcych userow. Endpoint ma
  // RBAC=LOGGED_USER, wiec bez tego guardu kazdy zalogowany user moglby pobrac
  // asset_url + stylist_info rekordu soft-deleted/dezaktywowanego stylisty (divergencja
  // z list/explore/profile, ktore juz filtruja). Zwracamy NOT_FOUND (404) zamiast 403 —
  // bez leaku istnienia rekordu.
  // This is the SAME pair as STYLIST_PUBLICLY_VISIBLE (account.config.ts), expressed as a
  // JS boolean (not a Prisma where) because the owner-bypass branch needs the values, not a
  // filter — callers fetch the record unconditionally, then this gates non-owners.
  const isStylistVisible =
    isAccountActive(record.created_by_account.account_status) &&
    record.created_by_account.created_by_user.is_active;
  if (!isStylistVisible) {
    return false;
  }

  // DECISION (nie usuwaj tego komentarza):
  // Pairing-gate na TRESC nie-pinowana (s26 EXPLORE-unpinned bug class, tu w detail-query).
  // DOMAIN_SSOT §4.1/§4.2: tylko PRZYPIETE (is_pinned=true) zdjecia sa publiczne; reszta
  // galerii = tresc gejtowana sparowaniem (widoczna dopiero po ACTIVE ClientStylistPair).
  // Endpoint ma RBAC=LOGGED_USER, findUnique pobiera rekord po ID bezwarunkowo — wiec bez
  // tego guardu KAZDY zalogowany, NIE-sparowany, obcy user posiadajacy/zgadujacy ID rekordu
  // dostawal 200 z asset_url + stylist_info (PII) nie-pinowanego rekordu (IDOR + enumeracja).
  // NON-OWNER wymaga: is_pinned===true LUB aktywnej pary klient↔stylista (parytet z
  // gallery-public is_pinned:true oraz gallery-paired-client ACTIVE-pair lookup). Brak →
  // GALLERY_RECORD_NOT_FOUND (404, bez leaku istnienia — anty-enumeracja). Revoked/pending
  // para = brak ACTIVE = brak dostepu.
  if (record.is_pinned) {
    return true;
  }
  const activePair = await DB_CLIENT.use.clientStylistPair.findFirst({
    where: {
      client_user_id: viewerUserId,
      stylist_account_id: record.created_by_account.account_id,
      status: PairingStatusValue.ACTIVE,
    },
    select: { id: true },
  });
  return Boolean(activePair);
};
