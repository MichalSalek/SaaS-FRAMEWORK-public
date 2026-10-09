/**
 * Content Moderation — Admin Operations
 *
 * Resolve report (approve/reject with action) and apply strike to users.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type {
  ContentReportNotFoundError,
  ContentReportAlreadyResolvedError,
} from '@kernel/domain/moderation/moderation-errors.types';
import type {
  AdminTargetProtectedError,
  AdminInsufficientPermissionsError,
} from '@kernel/domain/admin/admin-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import {
  ModerationAction,
  type ContentReportStatus,
  type ModerationAction as ModerationActionType,
} from '@kernel/models/moderation/moderation.dto';
import {
  ContentReportStatusValue,
  AccountStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import {
  lockUserRow,
  lockStylistAccountRow,
  isDeadlockError,
} from './moderation-admin-concurrency.helper';
// DECISION (nie usuwaj tego komentarza): cached_gallery_count writer mieszka w gallery
// (gallery jest właścicielem licznika) — moderation importuje go FROM gallery. Kierunek
// zależności moderation → gallery jest poprawny; lock/deadlock concern zostaje w moderation.
import { decrementGalleryCountFloored } from '@domain/gallery/operations/gallery-count.helper';
// DECISION (nie usuwaj tego komentarza): cached_likes_count writer mieszka w favorites
// (favorites jest właścicielem licznika, parytet z cached_gallery_count) — moderation
// importuje go FROM favorites. HIDE/DELETE/BAN ukrywają/usuwają widoczne rekordy, więc
// MUSZĄ zdekrementować lajki tych rekordów atomowo w tej samej $transaction (parytet z
// cached_gallery_count decrement obok). un-hide/un-ban NIE re-incrementują (świadoma
// asymetria, patrz DECISION przy BAN bulk-hide poniżej).
import { decrementLikeCountFloored } from '@domain/favorites/operations/favorite-count.helper';

// ── Resolve Report ──

type ResolveReportParams = {
  report_id: string;
  action: ModerationActionType;
  admin_note?: string | undefined;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
};

type ResolveReportResult = {
  report_id: string;
  status: ContentReportStatus;
  action: ModerationActionType;
  gallery_record_id: string | null;
  gallery_record_owner_user_id: string | null;
  gallery_record_owner_email: string | null;
};

export const resolveContentReport_IO = async (
  params: ResolveReportParams
): Promise<
  OperationResult<
    ResolveReportResult,
    | ContentReportNotFoundError
    | ContentReportAlreadyResolvedError
    | AdminTargetProtectedError
    | AdminInsufficientPermissionsError
    | DatabaseError
  >
> => {
  const { report_id, action, admin_note, currentUser } = params;

  // Defense-in-depth: route-level RBAC (ADMIN_RESOLVE_REPORT event wiring) stays,
  // but the operation guards its own boundary — parity with the read sibling
  // getContentReports_IO and the write sibling applyModerationStrike_IO. This is
  // the domain's most destructive mutation (ban + session-evict + hard-delete +
  // bulk-hide), so it must not trust it was only ever reached via the admin route.
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  const resolved_by_id = currentUser.id;

  try {
    // Transaction: check PENDING → update → optional delete to prevent double-resolve
    const result = await DB_CLIENT.use.$transaction(async tx => {
      // 1. Find the report with gallery record owner info
      const report = await tx.contentReport.findUnique({
        where: { id: report_id },
        include: {
          gallery_record: {
            select: {
              gallery_record_id: true,
              asset_url: true,
              is_hidden: true,
              created_by_account_id: true,
              created_by_account: {
                select: {
                  account_id: true,
                  created_by_user_id: true,
                  created_by_user: {
                    // role_id is read to enforce the BAN protected-target guard
                    // (parity with applyModerationStrike_IO). email is used for the
                    // owner-notification email on HIDE/DELETE.
                    select: { email: true, role_id: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!report) {
        return failure({
          type: 'CONTENT_REPORT_NOT_FOUND' as const,
          reportId: report_id,
        });
      }

      // 1a. Deterministic serialization point (finding admin-state-cascade-l2-1):
      // BEFORE writing any ContentReport row, take a pessimistic FOR UPDATE lock on the
      // single shared StylistAccount row that owns this report's gallery_record. Every
      // concurrent resolve touching the same stylist serializes through this one row in
      // one order → the A↔B sibling-report lock cycle that produced 40P01 deadlocks is
      // impossible (see DECISION in moderation-admin-concurrency.helper.ts). The loser
      // waits, then — once the winner committed — re-reads status below and exits cleanly
      // as ALREADY_RESOLVED instead of deadlocking/500-ing. Reports whose gallery_record
      // was already deleted (SetNull → null) have no shared account row AND no
      // resolveRelatedReports cross-lock path, so no lock is needed there.
      if (report.gallery_record != null) {
        // DECISION (nie usuwaj tego komentarza) — GLOBALNY INWARIANT KOLEJNOSCI LOCKOW: User → StylistAccount.
        // BAN mutuje DWA wiersze tej samej stylistki: User wlasciciela (is_active=false + disabled_at +
        // evict sesji, branch BAN nizej) ORAZ StylistAccount (account_status + cached_* + bulk-hide).
        // KAZDY inny multi-row pisarz lockuje je w kolejnosci User→StylistAccount (disableUser_IO /
        // disableSelfUser_IO / softDeleteAccount_IO / reactivateAccount_IO / enableUser_IO,
        // admin-bulk-disable/enable). Dlatego BAN MUSI wziac lock na User wlasciciela TU — ZANIM padnie
        // lockStylistAccountRow — by zachowac te kolejnosc. Bez tego BAN bral S (lockStylistAccountRow) →
        // U (user.update w branchu BAN), a wiec S→U, odwrotnie niz wszyscy: BAN i rownolegly self/admin
        // disable/enable/delete TEJ SAMEJ stylistki tworzyly cykl ABBA → Postgres 40P01 → nieobsluzone 500
        // (recoverable na retry, ale 500). Ten lock zamyka cykl deterministycznie (parytet z
        // lockStylistAccountRow, NIE Serializable+retry). Inwariant udokumentowany rowniez w lockUserRow
        // (moderation-admin-concurrency.helper.ts) i w disableSelfUser_IO (LOCK ORDER DECISION) — przyszli
        // pisarze MUSZA trzymac User-first. Lock pada PRZED lockStylistAccountRow, ale lockStylistAccountRow
        // nadal pada PRZED jakimkolwiek zapisem ContentReport, wiec serializacja l2-1 (sibling-report
        // deadlock) jest nienaruszona; HIDE/DELETE nie lockuja User (nie dotykaja konta osoby) → ta sama
        // kolejnosc, brak nowego cyklu. owner-id z lancucha ownership (ten sam co user.update + response).
        const banOwnerUserId =
          action === ModerationAction.BAN
            ? report.gallery_record.created_by_account?.created_by_user_id
            : undefined;
        if (banOwnerUserId != null) {
          await lockUserRow(tx, banOwnerUserId);
        }

        await lockStylistAccountRow(
          tx,
          report.gallery_record.created_by_account_id
        );

        // Re-read status AFTER acquiring the lock. Under READ COMMITTED the initial
        // findUnique above ran on a pre-lock snapshot; a concurrent winner may have
        // auto-resolved THIS report (resolveRelatedReports) while we waited for the lock.
        // The post-lock read sees the winner's committed state → clean conflict, no
        // silent no-op of the losing moderation action.
        const lockedStatus = await tx.contentReport.findUnique({
          where: { id: report_id },
          select: { status: true },
        });
        if (lockedStatus === null) {
          // Report hard-deleted while we waited for the lock (e.g. FK cascade
          // after the reporter's account erasure). Without this guard we would
          // fall through to contentReport.update on a missing row → P2025 →
          // outer catch (which only maps 40P01) → opaque DATABASE_ERROR 500.
          return failure({
            type: 'CONTENT_REPORT_NOT_FOUND' as const,
            reportId: report_id,
          });
        }
        if (lockedStatus.status !== ContentReportStatusValue.PENDING) {
          return failure({
            type: 'CONTENT_REPORT_ALREADY_RESOLVED' as const,
            reportId: report_id,
          });
        }
      }

      if (report.status !== ContentReportStatusValue.PENDING) {
        return failure({
          type: 'CONTENT_REPORT_ALREADY_RESOLVED' as const,
          reportId: report_id,
        });
      }

      // 1c. Protected-target guard for BAN (finding admin-moderation-2).
      // DECISION (nie usuwaj tego komentarza):
      // BAN deactivates the gallery-record OWNER's User row (is_active=false +
      // session eviction, see BAN branch below) — it acts on the PERSON, exactly like
      // applyModerationStrike_IO targets a user. So it MUST carry the same protected-target
      // guard as apply-strike (moderation-strike.operations.ts): reject banning yourself or
      // another MASTER_ADMIN, surfacing the shared ADMIN_TARGET_PROTECTED error
      // (error-mapper → 403 + reason). Without this, once admins can own gallery records
      // (e.g. an admin onboards a stylist account — admin-seeding.operations.ts proves this
      // is architecturally possible), one admin could ban another via a reported record.
      // Guard runs BEFORE the report status write below so a rejection rolls nothing back
      // (no row has been mutated yet) — same no-partial-commit contract as the
      // ALREADY_RESOLVED early returns above; we do NOT need a sentinel-throw rollback here.
      // Scoped to BAN ONLY (NOT HIDE/DELETE): those act on a CONTENT record, not on the
      // owner's account/User, so they carry no person-level/account-disable impact and
      // need no actor-relationship guard — the asymmetry mirrors apply-strike's user-target
      // semantics and is intentional.
      if (action === ModerationAction.BAN && report.gallery_record != null) {
        const targetUserId =
          report.gallery_record.created_by_account?.created_by_user_id;
        const targetRoleId =
          report.gallery_record.created_by_account?.created_by_user?.role_id;
        if (targetUserId != null && targetUserId === resolved_by_id) {
          return failure({
            type: 'ADMIN_TARGET_PROTECTED' as const,
            reason: 'ADMIN_CANNOT_TARGET_SELF' as const,
          });
        }
        if (targetRoleId === SystemRoleId.MASTER_ADMIN) {
          return failure({
            type: 'ADMIN_TARGET_PROTECTED' as const,
            reason: 'ADMIN_CANNOT_TARGET_ADMIN' as const,
          });
        }
      }

      // 2. Determine status based on action
      // WARN/HIDE/DELETE/BAN = report was valid, action taken → APPROVED
      // DISMISS = report invalid/unfounded → REJECTED. DISMISS has ZERO side
      // effects on the content/owner (no hide/delete/strike/ban, no owner email)
      // — it only closes the report; see moderation.dto.ts.
      const ACTION_TO_STATUS: Record<
        ModerationActionType,
        ContentReportStatus
      > = {
        WARN: ContentReportStatusValue.APPROVED,
        HIDE: ContentReportStatusValue.APPROVED,
        DELETE: ContentReportStatusValue.APPROVED,
        BAN: ContentReportStatusValue.APPROVED,
        DISMISS: ContentReportStatusValue.REJECTED,
      };
      const status: ContentReportStatus = ACTION_TO_STATUS[action];

      // Effective action actually applied (finding admin-moderation-3).
      // DECISION (nie usuwaj tego komentarza):
      // When the report's gallery_record is null (the record was already deleted →
      // gallery_record_id SetNull → null), NONE of the HIDE/DELETE/BAN side effects below
      // can run — there is no record to hide/delete and no owner account/user to ban (the
      // whole `if (report.gallery_record != null)` block is skipped). The only thing that
      // happens is the stale PENDING report gets closed. Echoing the requested destructive
      // `action` (e.g. BAN) in that case is misleading — the admin would believe a ban
      // occurred. So we report the EFFECTIVE action: WARN, which is precisely
      // "report reviewed/closed, no content action taken" (WARN never mutates the record,
      // even when one exists — there is no WARN branch below). This keeps the response
      // truthful WITHOUT a kernel change: WARN is an existing ModerationAction value and the
      // response shape is unchanged. We deliberately do NOT reject the call — closing a stale
      // orphaned report is legitimate and desirable; only the echoed action must be honest.
      // DISMISS is exempt from the downgrade: it never has content side effects in the first
      // place (closing as REJECTED is its FULL effect), so echoing it is always truthful —
      // and rewriting it to WARN would lie in the other direction (WARN implies APPROVED).
      const effectiveAction: ModerationActionType =
        report.gallery_record == null && action !== ModerationAction.DISMISS
          ? ModerationAction.WARN
          : action;

      // 3. Update report
      await tx.contentReport.update({
        where: { id: report_id },
        data: {
          status,
          admin_note: admin_note || null,
          resolved_by_id,
          resolved_at: new Date(),
        },
      });

      // 4. Apply moderation action on gallery record if needed
      if (report.gallery_record != null) {
        const recordId = report.gallery_record.gallery_record_id;
        const accountId = report.gallery_record.created_by_account_id;

        // Helper: resolve all other pending reports for this record
        const resolveRelatedReports = async (scope: 'record' | 'account') => {
          const where =
            scope === 'record'
              ? {
                  gallery_record_id: recordId,
                  id: { not: report_id },
                  status: ContentReportStatusValue.PENDING,
                }
              : {
                  gallery_record: { created_by_account_id: accountId },
                  id: { not: report_id },
                  status: ContentReportStatusValue.PENDING,
                };

          await tx.contentReport.updateMany({
            where,
            data: {
              status: ContentReportStatusValue.APPROVED,
              resolved_by_id,
              resolved_at: new Date(),
              admin_note: `Auto-resolved: gallery record actioned (${action}) via report ${report_id}`,
            },
          });
        };

        if (action === ModerationAction.HIDE) {
          // Hide the reported record — keeps data, invisible to public queries.
          // DECISION (nie usuwaj tego komentarza):
          // QA admin-moderation-2: HIDE MUSI atomowo zdekrementowac
          // cached_gallery_count (parytet z DELETE branch). photo_count na publicznej
          // karcie (public-stylists-list) czyta surowy cached_gallery_count, podczas gdy
          // total_count galerii filtruje is_hidden:false — bez dekrementu karta na stale
          // zawyzala liczbe zdjec (a cold-start backfill liczy ALL records, wiec
          // re-potwierdzal zla wartosc zamiast ja naprawic).
          // Guard double-decrement: updateMany WHERE is_hidden:false → dekrement TYLKO
          // gdy rekord faktycznie przeszedl z widocznego na ukryty (count===1).
          // Re-run HIDE na juz-ukrytym rekordzie (lub BAN bulk-hide) NIE podwoji odejmowania.
          // Count likes of THIS record BEFORE hiding it (after updateMany the record is
          // hidden, so it would no longer count toward cached_likes_count). FavoriteGalleryRecord
          // has no FK to StylistAccount — likes are keyed by gallery_record_id (created_by_account_id
          // resolved once above).
          const likesHidden = await tx.favoriteGalleryRecord.count({
            where: { gallery_record_id: recordId },
          });
          const hidden = await tx.galleryRecord.updateMany({
            where: { gallery_record_id: recordId, is_hidden: false },
            data: { is_hidden: true },
          });
          if (hidden.count === 1) {
            // Floor-at-zero decrement (finding admin-state-cascade-l2-4): GREATEST(0, …)
            // so a pre-existing understated cache (backfill counts ALL records, this path
            // counts VISIBLE) can never drive the public photo_count below zero.
            await decrementGalleryCountFloored(tx, accountId, 1);
            // Parytet: cached_likes_count też liczy lajki WIDOCZNYCH rekordów — ukrycie
            // rekordu odejmuje jego lajki. Guard hidden.count===1 chroni przed
            // podwójnym dekrementem przy re-HIDE już-ukrytego rekordu.
            if (likesHidden > 0) {
              await decrementLikeCountFloored(tx, accountId, likesHidden);
            }
          }
          await resolveRelatedReports('record');
        }

        if (action === ModerationAction.DELETE) {
          // Capture visibility + like count BEFORE deletion. is_hidden comes from the
          // findUnique fetch above (records become unreachable after delete; the
          // FavoriteGalleryRecord rows cascade away too).
          const wasVisible = report.gallery_record.is_hidden === false;
          const likesDeleted = wasVisible
            ? await tx.favoriteGalleryRecord.count({
                where: { gallery_record_id: recordId },
              })
            : 0;
          // Resolve related reports before deletion (SetNull will clear gallery_record_id)
          await resolveRelatedReports('record');
          // DECISION (nie usuwaj tego komentarza):
          // Idempotentny deleteMany zamiast throwującego delete (parytet z updateMany/
          // deleteMany count-guardami reszty pliku). `report.gallery_record` pochodzi ze
          // SNAPSHOTU findUnique (przed lockStylistAccountRow), a post-lock re-read odświeża
          // TYLKO status, nie istnienie rekordu — więc równoległy owner deleteGalleryRecord_IO
          // mógł wygrać lock, skasować GalleryRecord (SetNull na report.gallery_record_id) i
          // zacommitować, zanim tu dotrzemy. `delete` na nieistniejącym wierszu rzucał P2025,
          // a outer catch łapie tylko isDeadlockError (40P01) → databaseFailure → HTTP 500 dla
          // admina zamiast czystego zamknięcia. deleteMany zwraca count 0 zamiast rzucać:
          // główny report i tak zamyka się (update wyżej, l. „3. Update report"), a decrementy
          // cache pomijamy — owner-delete już je policzył (nie wolno odejmować podwójnie).
          const deleted = await tx.galleryRecord.deleteMany({
            where: { gallery_record_id: recordId },
          });
          if (deleted.count === 1) {
            // DECISION (nie usuwaj tego komentarza):
            // Mirror gallery-delete.operation.ts — decrement cached_gallery_count atomically
            // when moderation hard-deletes a record. D7+DD3-D1 run 24.
            // VISIBILITY-GATED (finding gallery-count-double-decrement, /spar-confirmed): decrement ONLY when
            // the record was visible (wasVisible). cached_gallery_count tracks VISIBLE records (is_hidden=false,
            // RC-011); a record already HIDDEN (by a prior HIDE/BAN, which decremented at hide-time) is NOT in
            // the counter, so deleting it must subtract 0 — an unconditional decrement double-subtracts and
            // drifts the public photo_count below the live visible-count (floor masks it >=0 but the raw value
            // read by public-stylists-list understates). Parytet z cached_likes_count gate below (likesDeleted=0
            // gdy !wasVisible). Floor (GREATEST(0,…)) = last-line defense.
            if (wasVisible) {
              await decrementGalleryCountFloored(tx, accountId, 1);
            }
            // Parytet: cached_likes_count liczy lajki WIDOCZNYCH rekordów — usunięcie
            // rekordu odejmuje jego lajki TYLKO jeśli był widoczny (is_hidden=false). Rekord
            // już-ukryty miał lajki odjęte przy HIDE/BAN, więc ponowne odejmowanie przy
            // DELETE podwoiłoby dekrement (parytet z guardem hidden.count===1 w HIDE).
            if (likesDeleted > 0) {
              await decrementLikeCountFloored(tx, accountId, likesDeleted);
            }
          }
        }

        if (action === ModerationAction.BAN) {
          // 1. Deactivate the stylist account
          // DECISION (nie usuwaj tego komentarza):
          // Idempotentny updateMany zamiast throwującego update (parytet z DELETE-branch
          // deleteMany + disableUser_IO stylistAccount.updateMany). `report.gallery_record`
          // pochodzi ze snapshotu findUnique (przed lockiem); równoległy owner hard-delete
          // (deleteUser_IO/GDPR-erase/moveExpiredUserToArchive_IO — cascade User→StylistAccount)
          // mógł skasować wiersz konta w oknie przed-lock (FOR UPDATE na skasowanym-i-
          // -zacommitowanym wierszu zwraca 0 rzędów, nie blokuje). `update` rzucał wtedy P2025,
          // a outer catch łapie tylko 40P01 → databaseFailure → opaque 500 dla admina.
          // updateMany zwraca count 0 zamiast rzucać: reszta BAN-branch jest już count-safe
          // (user.updateMany/session/galleryRecord.updateMany guarded), a główny report
          // zamyka się przez update wyżej (l. „3. Update report").
          await tx.stylistAccount.updateMany({
            where: { account_id: accountId },
            data: { account_status: AccountStatusValue.NOT_ACTIVE },
          });

          // DECISION (nie usuwaj tego komentarza):
          // QA admin-moderation-1: BAN MUSI tez wylaczyc wiersz User
          // (is_active=false + disabled_at) — parytet z admin disable (disableUser_IO).
          // account-state-guard klasyfikuje stan WYLACZNIE po User.is_active /
          // deleted_at / recovery_available (swiadomie ignoruje account_status oraz
          // disabled_at). Sam flip account_status=NOT_ACTIVE blokowal tylko gating
          // oparty na account_status (np. requireStylistAccount → tworzenie galerii),
          // ale zbanowany user zachowywal CALA warstwe BASE/LOGGED: m.in.
          // REPORT_GALLERY_RECORD (BASE-tier, tylko requireAuthenticatedContext),
          // favorites, support threads, notification/email prefs. Flip is_active w tej
          // samej $transaction sprawia, ze account-state-guard zaklasyfikuje ADMIN-BAN
          // i zablokuje wszystko poza get-current/logout — "ban" faktycznie banuje.
          // Owner user id z lancucha ownership (gallery_record → created_by_account →
          // created_by_user_id), ten sam ktory zwracamy w response.
          const ownerUserId =
            report.gallery_record.created_by_account?.created_by_user_id;
          if (ownerUserId != null) {
            // DECISION (nie usuwaj tego komentarza):
            // ban-user-state-2: BAN flip User jest IDEMPOTENTNY — guarded updateMany
            // WHERE disabled_at:null (parytet z disableUser_IO / disableSelfUser_IO CAS).
            // BAN owijajacy juz-wylaczonego usera (np. admin disable wygral wczesniej, albo
            // re-resolve) NIE wolno nadpisac disabled_at: znacznik PIERWSZEGO wylaczenia =
            // SSOT idempotencji (parytet z disableUser_IO; bez tego BAN nadpisywal go nowym
            // Date() i re-evictowal sesje przy kazdym powtorzeniu). Ten wiersz User jest JUZ
            // trzymany pod FOR UPDATE (lockUserRow wziety na poczatku tx, PRZED
            // lockStylistAccountRow — patrz LOCK ORDER DECISION wyzej): globalna kolejnosc
            // User→StylistAccount, brak nowego deadlock-surface. count===0 => juz wylaczony =>
            // NIE evictujemy ponownie (nastepstwa bramkowane faktyczna zmiana stanu, parytet
            // z disableUser_IO stateChanged-gate).
            const banned = await tx.user.updateMany({
              where: { id: ownerUserId, disabled_at: null },
              data: { is_active: false, disabled_at: new Date() },
            });
            if (banned.count > 0) {
              // Evict active sessions atomically with the ban (parity with
              // disableUser_IO, which deletes sessions in the same mutation) so the
              // banned user's existing tokens stop working immediately, not after
              // session TTL.
              await tx.session.deleteMany({ where: { userId: ownerUserId } });
            }
          }

          // 2. Hide ALL still-visible gallery records from this stylist.
          // DECISION (nie usuwaj tego komentarza):
          // QA admin-moderation-2 (BAN sub-claim): dekrementuj cached_gallery_count
          // o liczbe rekordow ktore FAKTYCZNIE przeszly z widocznych na ukryte
          // (updateMany WHERE is_hidden:false → count), inaczej cache zawyzalby
          // photo_count gdyby konto pozniej wrocilo do widocznosci (re-enable).
          //
          // DECISION (nie usuwaj tego komentarza) — asymetria ban↔un-ban jest CELOWA
          // (finding admin-state-cascade-l2-5, close-wins): BAN ukrywa WSZYSTKIE rekordy
          // (is_hidden=true) + dekrementuje licznik, ale un-ban (enableUser_IO /
          // cascadeBulkEnableAccountStatus) przywraca TYLKO account_status=ACTIVE/is_active
          // — NIE od-ukrywa rekordów. To jest BEZPIECZNY kierunek i tak ma zostać:
          //  • ban ukrywa galerię z powodu naruszenia treści; automatyczne ponowne
          //    wyeksponowanie moderacyjnie-ukrytej treści przy zwykłym re-enable byłoby
          //    NIEbezpieczne (re-publikacja tego, co usunięto z widoku za karę).
          //  • enable nie potrafi odróżnić rekordów ukrytych przez moderację od ukrytych
          //    intencjonalnie przez właściciela, więc hurtowe is_hidden=false byłoby błędne.
          // Skutek: po un-banie profil wraca, ale galeria zostaje pusta do JAWNEGO
          // moderacyjnego przeglądu (brak akcji un-hide w ModerationAction = WARN/HIDE/DELETE/
          // BAN — to świadoma luka, nie regresja). cached_gallery_count został zfloorowany do
          // liczby widocznych (0 po ukryciu wszystkich), więc publiczna karta nie zawyża.
          // Gdyby właściciel produktu chciał symetrycznego restore — to ODDZIELNA, jawna
          // akcja moderacyjna (un-hide per rekord), nie auto-side-effect enable.
          // Count likes across ALL still-visible records of this account BEFORE the bulk
          // hide (after updateMany they are hidden, so they would no longer count toward
          // cached_likes_count). BAN hides pinned records too → NO is_pinned filter, mirror
          // the bulk-hide predicate exactly (created_by_account_id + is_hidden:false). The
          // join FavoriteGalleryRecord → GalleryRecord is via the related-record filter.
          const banLikes = await tx.favoriteGalleryRecord.count({
            where: {
              record: {
                created_by_account_id: accountId,
                is_hidden: false,
              },
            },
          });
          const bulkHidden = await tx.galleryRecord.updateMany({
            where: { created_by_account_id: accountId, is_hidden: false },
            data: { is_hidden: true },
          });
          if (bulkHidden.count > 0) {
            // Floor-at-zero decrement (finding admin-state-cascade-l2-4).
            await decrementGalleryCountFloored(tx, accountId, bulkHidden.count);
            // Parytet: cached_likes_count też liczy lajki widocznych rekordów — BAN
            // ukrywa wszystkie, więc odejmujemy ich lajki. un-ban NIE re-incrementuje
            // (świadoma asymetria, parytet z cached_gallery_count — patrz DECISION wyżej).
            if (banLikes > 0) {
              await decrementLikeCountFloored(tx, accountId, banLikes);
            }
          }

          // 3. Resolve all pending reports targeting any record from this stylist
          await resolveRelatedReports('account');
        }
      }

      return success({
        report,
        status,
        effectiveAction,
      });
    });

    if (!result.success) {
      return result;
    }

    const { report, status, effectiveAction } = result.data;

    if (action === ModerationAction.HIDE && report.gallery_record != null) {
      reportIssueBackend({
        namespace: 'MODERATION_RECORD_HIDDEN',
        message: `Gallery record ${report.gallery_record.gallery_record_id} hidden by admin moderation`,
        payload: { reportId: report_id, action },
        mode: 'info',
      });
    }

    if (action === ModerationAction.DELETE && report.gallery_record != null) {
      reportIssueBackend({
        namespace: 'MODERATION_RECORD_DELETED',
        message: `Gallery record ${report.gallery_record.gallery_record_id} deleted by admin moderation`,
        payload: { reportId: report_id, action },
        mode: 'info',
      });
    }

    if (action === ModerationAction.BAN && report.gallery_record != null) {
      reportIssueBackend({
        namespace: 'MODERATION_ACCOUNT_BANNED',
        message: `Stylist account ${report.gallery_record.created_by_account_id} banned and all records hidden by admin moderation`,
        payload: {
          reportId: report_id,
          action,
          accountId: report.gallery_record.created_by_account_id,
        },
        mode: 'warn',
      });
    }

    reportIssueBackend({
      namespace: 'MODERATION_REPORT_RESOLVED',
      message: `Report ${report_id} resolved with action ${effectiveAction} (requested ${action}) by admin ${resolved_by_id}`,
      payload: { reportId: report_id, action: effectiveAction, status },
      mode: 'info',
    });

    return success({
      report_id,
      status,
      action: effectiveAction,
      gallery_record_id: report.gallery_record_id,
      gallery_record_owner_user_id:
        report.gallery_record?.created_by_account?.created_by_user_id ?? null,
      gallery_record_owner_email:
        report.gallery_record?.created_by_account?.created_by_user?.email ??
        null,
    });
  } catch (error) {
    // Defence-in-depth (finding admin-state-cascade-l2-1): the deterministic
    // lockStylistAccountRow above eliminates the resolve-report deadlock cycle, so this
    // branch should not fire for 40P01 anymore. But if any unforeseen path still cycles,
    // a deadlock here means a concurrent moderation already won the race on this report
    // (the tx rolled back) → surface a clean ALREADY_RESOLVED conflict instead of an
    // opaque 500. isDeadlockError detects SQLSTATE 40P01 specifically (distinct from
    // isSerializationConflict's 40001) — see moderation-admin-concurrency.helper.ts.
    if (isDeadlockError(error)) {
      reportIssueBackend({
        namespace: 'MODERATION_RESOLVE_DEADLOCK',
        message: `Resolve-report deadlock (40P01) on report ${report_id} — concurrent moderation won; mapped to ALREADY_RESOLVED`,
        payload: { report_id, action },
        mode: 'warn',
      });
      return failure({
        type: 'CONTENT_REPORT_ALREADY_RESOLVED' as const,
        reportId: report_id,
      });
    }
    return databaseFailure('resolveContentReport', error);
  }
};
