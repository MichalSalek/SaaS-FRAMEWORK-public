/**
 * SessionContainer shared helpers (R8)
 *
 * Mappers, constants, and utility functions used by both commands and queries.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import type { Prisma } from '../../../prisma/js-client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import {
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
  type NailLength,
  type SessionContainer as PrismaSessionContainer,
  type SessionContainerLifecycleState,
  type SessionContainerPhoto as PrismaSessionContainerPhoto,
} from '@kernel/models/db_models.generated.dto';
import type {
  SessionContainerDTO,
  SessionContainerDetailDTO,
  SessionContainerPhotoDTO,
} from '@kernel/models/session-container/session-container.dto';

// Constants
const MILLISECONDS_PER_DAY = TIME.MS_PER_DAY;

// ─── Viewer-side field authorization ───────────────────────────────────────

/**
 * Which party is reading the session. Drives read-side field masking of
 * stylist-private fields (currently `stylistNote`).
 */
export type SessionViewerSide = 'stylist' | 'client';

// DECISION (nie usuwaj tego komentarza):
// `stylistNote` jest stylist-private (DOMAIN_SSOT §3.2, linia 175/246: "widoczna
// TYLKO dla stylistki"). Dlatego mapper maskuje ją (=> null) dla KAŻDEGO viewera,
// który nie jest przypisaną stylistką. Parametr `viewerSide` jest OPCJONALNY i
// DOMYŚLNIE maskuje (fail-safe): wszystkie ścieżki, które nie podadzą jawnie
// 'stylist', NIE wyciekną notatki. To celowo broni callerów client-only
// (create / add-photo / share — wszystkie za requireClientAccount), które tej
// flagi nie przekazują. Pełne ujawnienie stylistNote NASTĘPUJE wyłącznie gdy
// caller jawnie poda viewerSide==='stylist' po potwierdzeniu, że viewer jest
// przypisaną stylistką tej konkretnej sesji. `clientNote` jest dwustronna
// (klientka pisze, stylistka czyta w Visual CRM) — NIE jest maskowana.
const maskSessionPrivateFields = (
  dto: SessionContainerDTO,
  viewerSide: SessionViewerSide | undefined
): SessionContainerDTO =>
  viewerSide === 'stylist' ? dto : { ...dto, stylistNote: null };

/**
 * Resolve the viewer side for a given session row from the reader's account
 * context. Returns 'stylist' ONLY when the reader is the assigned stylist of
 * THIS session (so stylist-private fields are revealed to her); otherwise
 * 'client' (masked). The reader must already be authorized to read the row —
 * this only decides field visibility, not access.
 *
 * Note: a session's client and stylist are always distinct accounts, so a
 * reader cannot be both the owning client and the assigned stylist of the same
 * row. When in doubt (no stylist match) we default to the masked 'client' side.
 */
export const resolveViewerSide = ({
  sessionStylistAccountId,
  viewerStylistAccountId,
}: {
  sessionStylistAccountId: string | null;
  viewerStylistAccountId: string | undefined;
}): SessionViewerSide =>
  Boolean(viewerStylistAccountId) &&
  sessionStylistAccountId === viewerStylistAccountId
    ? 'stylist'
    : 'client';

// ─── Helpers ──────────────────────────────────────────────────────────────

export const calculateExpiresAt = (days: number): Date =>
  new Date(Date.now() + days * MILLISECONDS_PER_DAY);

export const toDtoLifecycleState = (
  state: PrismaSessionContainer['lifecycle_state']
): SessionContainerLifecycleState => state as SessionContainerLifecycleState;

// ─── Client name hydration ──────────────────────────────────────────────────

// A session row optionally joined with its owning client's User.name. Read paths
// (get-my / get-by-id / loadSessionDetail) include the relation so the stylist's
// inbox can show WHO shared the session; write paths pass a plain row and the DTO
// falls back to clientName === null. The relation shape is OPTIONAL at every level
// so a bare PrismaSessionContainer is still assignable (no call-site churn).
export type SessionRowWithClient = PrismaSessionContainer & {
  client_account?: {
    created_by_user_id?: string;
    created_by_user?: { name: string | null } | null;
  } | null;
};

// Prisma-side select used by every read path that maps to a SessionContainerDTO —
// single SSOT so get-my and get-by-id hydrate the name identically.
// DECISION (nie usuwaj tego komentarza): imię klientki jest CELOWO hydratowane BEZ
// filtra `created_by_user.is_active` — soft-deleted (odwracalna, in-place, 90d recovery
// §13.1) klientka NADAL pokazuje imię w schowku stylistki. To NIE jest ten sam kontrakt
// co LIVE-relationship surfaces (get-my-pairs / pending-requests filtrują is_active, bo
// ukrywają NIEAKTYWNĄ RELACJĘ) — SessionContainer to Visual CRM archive (DOMAIN_SSOT
// „Archiwum sesji", killer feature: historia sesji per klientka), gdzie kontekst KTO
// persystuje z założenia, parytet z crm_note (przeżywa revoke) i VisitRecords. Realna
// granica PII = TERMINAL hard-delete (GDPR-erase / 90d MOVE → DeletedUser.body, odpięcie
// od żywych tabel), pokryty audytem archive-cascade-completeness. NIE dodawać is_active
// maski „dla parytetu z get-my-pairs" — zdegradowałaby archiwum (stylistka traci KTÓRA
// klientka). QA testy-api s23-pairing (L2 seam: premisa „leak" sprzeczna z modelem CRM).
export const CLIENT_NAME_INCLUDE = {
  client_account: {
    select: {
      created_by_user_id: true,
      created_by_user: { select: { name: true } },
    },
  },
} as const;

const resolveClientName = (session: SessionRowWithClient): string | null => {
  const raw = session.client_account?.created_by_user?.name;
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

export const mapSessionToDTO = (
  session: SessionRowWithClient,
  photoCount: number,
  viewerSide?: SessionViewerSide
): SessionContainerDTO =>
  maskSessionPrivateFields(
    {
      id: session.id,
      clientAccountId: session.client_account_id,
      clientName: resolveClientName(session),
      clientUserId: session.client_account?.created_by_user_id ?? null,
      stylistAccountId: session.stylist_account_id ?? null,
      name: session.name ?? null,
      lifecycleState: toDtoLifecycleState(session.lifecycle_state),
      stylistNote: session.stylist_note ?? null,
      clientNote: session.client_note ?? null,
      sharedAt: session.shared_at
        ? new Date(session.shared_at).toISOString()
        : null,
      expiresAt: session.expires_at
        ? new Date(session.expires_at).toISOString()
        : null,
      closedAt: session.closed_at
        ? new Date(session.closed_at).toISOString()
        : null,
      createdAt: new Date(session.created_at).toISOString(),
      updatedAt: new Date(session.updated_at).toISOString(),
      photoCount,
    },
    viewerSide
  );

export type PhotoWithOptionalGalleryRecord = PrismaSessionContainerPhoto & {
  gallery_record_data?: {
    gallery_record_id: string;
    asset_url: string;
    nail_length: NailLength;
    is_pinned: boolean;
    created_by_account_id: string;
  } | null;
};

export const mapPhotoToDTO = (
  photo: PhotoWithOptionalGalleryRecord
): SessionContainerPhotoDTO => ({
  id: photo.id,
  sessionId: photo.session_id,
  galleryRecordId: photo.gallery_record_id,
  position: photo.position,
  createdAt: new Date(photo.created_at).toISOString(),
  ...(photo.gallery_record_data
    ? { galleryRecord: photo.gallery_record_data }
    : {}),
});

export const mapSessionToDetailDTO = (
  session: SessionRowWithClient,
  photos: PhotoWithOptionalGalleryRecord[],
  // DECISION (nie usuwaj tego komentarza): photoCount jest PRZEKAZYWANY jawnie (total,
  // niezależny count), NIE derywowany z photos.length. photos jest cap'owane na take:200
  // w loadSessionDetail_IO, a get-my raportuje prawdziwy _count.photos — bez tego detail
  // dla sesji >200 zdjęć pokazywałby 200, a lista rzeczywistą liczbę (rozjazd + „znikające"
  // ostatnie zdjęcia). Brak business-cap SESSION_MAX_PHOTOS, więc oba muszą liczyć tak samo.
  photoCount: number,
  viewerSide?: SessionViewerSide
): SessionContainerDetailDTO => ({
  ...mapSessionToDTO(session, photoCount, viewerSide),
  photos: photos
    .slice()
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.created_at.getTime() - b.created_at.getTime()
    )
    .map(mapPhotoToDTO),
});

export const isClosedOrExpired = (
  state: SessionContainerLifecycleState
): boolean =>
  state === SessionContainerLifecycleStateValue.CLOSED ||
  state === SessionContainerLifecycleStateValue.EXPIRED;

export const isShareableState = (
  state: SessionContainerLifecycleState
): boolean =>
  state === SessionContainerLifecycleStateValue.DRAFT ||
  state === SessionContainerLifecycleStateValue.READY;

// DECISION (nie usuwaj tego komentarza) — write-side TTL parytet (finding sc-addphoto-1):
// SHARED/ACTIVE sesja z expires_at <= now, ale jeszcze NIEZAMIECIONA przez
// session-container-expiry-interceptor (throttle ~6h), jest EFEKTYWNIE terminalna,
// mimo że lifecycle_state nadal !== EXPIRED. Read-side (getMySessionContainers_IO)
// i create/share (SC-4 notExpiredFilter) JUŻ to lustrują — write-path add-photo/
// set-note MUSZĄ też, inaczej klientka dopisuje zdjęcia/notatki do wygasłej sesji
// przez okno do ~6h (asymetria BEZ DECISION-a = oversight, nie decyzja). null =
// brak TTL (DRAFT/READY nigdy nie wygasa) → false. Point-in-time check (Date.now()),
// bo write-path ma świeży wiersz w ręku (nie Prisma WHERE jak count-guardy).
export const isPastTtl = (expiresAt: Date | null): boolean =>
  expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();

export const SHARED_STATES_FOR_PRISMA = [
  SessionContainerLifecycleStateValue.SHARED,
  SessionContainerLifecycleStateValue.ACTIVE,
] as const;

// ─── Pairing helper (shared with session-share semantics) ─────────────────

/**
 * Look up the ACTIVE pairing between a client and a VISIBLE stylist.
 *
 * Pass `tx` (a `$transaction` callback client) to run the check INSIDE that
 * transaction so it observes the same READ COMMITTED snapshot as concurrent
 * writes — required by add-photo's in-TX re-validation to close the pairing
 * TOCTOU window. When omitted, runs against the module-level client.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Wszyscy callerzy tego helpera to WRITE-paths session-containera, które gejtują
 * akcję cross-account klient→stylista: create (commands), share, add-photo
 * (pre-flight + in-TX re-check). KAŻDY z nich wymaga, by stylista był nadal
 * WIDOCZNY (STYLIST_PUBLICLY_VISIBLE: account_status===ACTIVE AND
 * created_by_user.is_active===true). Samo `ClientStylistPair.status===ACTIVE`
 * NIE wystarcza: admin-ban kaskaduje account_status=NOT_ACTIVE, a self soft-delete
 * (DOMAIN_SSOT §13.1) flaguje is_active=false — OBA zostawiają wiersz pary jako
 * ACTIVE. Bez tego predykatu klient sparowany ze zdjętym/zbanowanym stylistą mógł
 * tworzyć/share'ować sesje i dodawać zdjęcia → PII (zdjęcia, name, clientNote)
 * lądowało w CRM zdjętego konta (czytelne po re-enable) + ghost session rows +
 * niespójny pairing-oracle (write succeeds, a getAccessStatus/bookmark/increment-view
 * raportują stylistę jako niewidocznego). To MIRROR getAccessStatus (PAIRED tylko gdy
 * account_status===ACTIVE) i M3 bookmarkStylist (visibility-gate przed write). Join na
 * relacji `stylist_account` egzekwuje gate ATOMOWO również w add-photo in-TX re-check
 * (helper dostaje `tx`) — niewidoczność wykryta in-tx → PairingRevokedInTxError →
 * collapse do SESSION_CONTAINER_NOT_PAIRED (parytet anty-enumeracji: klient nie
 * rozróżnia banned/soft-deleted vs never-paired). READ-paths (getMy / getById /
 * loadSessionDetail) NIE wołają tego helpera — czytają wiersze sesji wprost, więc
 * istniejąca sesja ze zdjętym stylistą pozostaje czytelna/zamykalna (stylist-side
 * już guarded przez account-state-guard + SCCAP-3 terminal-never-shared). Para ZOSTAJE
 * w DB (nie kasujemy); po re-enable stylisty write znów przechodzi (flip odwracalny).
 */
export const findActivePairing = async (
  client_user_id: string,
  stylist_account_id: string,
  tx?: Prisma.TransactionClient
) =>
  (tx ?? DB_CLIENT.use).clientStylistPair.findFirst({
    where: {
      client_user_id,
      stylist_account_id,
      status: PairingStatusValue.ACTIVE,
      stylist_account: STYLIST_PUBLICLY_VISIBLE,
      // SM-1: symmetric with the stylist-side guard (lifecycle close/set-note) and the
      // visit/contact/CRM pattern — a self soft-deleted party (is_active=false) leaves
      // the pairing ACTIVE (DOMAIN_SSOT §13.1). Callers here are client-actor write
      // paths (create/share/add-photo); a soft-deleted client can't reach a live
      // session anyway (account-state-guard), so this is defense-in-depth + parity so
      // no session-container pairing check trusts `status: ACTIVE` alone.
      client_user: { is_active: true },
    },
    select: { id: true },
  });
