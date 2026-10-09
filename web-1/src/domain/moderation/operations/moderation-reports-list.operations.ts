import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  ContentReportReason,
  ContentReportStatus,
} from '@kernel/models/moderation/moderation.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';

// ── Get Content Reports (Admin) ──

type GetContentReportsParams = {
  status?: ContentReportStatus | undefined;
  page?: number | undefined;
  limit?: number | undefined;
};

export const getContentReports_IO = async ({
  currentUser,
  params,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  params: GetContentReportsParams;
}): Promise<
  OperationResult<
    {
      reports: Array<{
        id: string;
        gallery_record_id: string | null;
        reporter_id: string;
        reason: ContentReportReason;
        description: string | null;
        status: ContentReportStatus;
        admin_note: string | null;
        created_at: Date;
        resolved_at: Date | null;
        gallery_record: {
          asset_url: string;
          created_by_account_id: string;
          gallery_record_owner_user_id: string | null;
          owner_active_strikes: number;
        } | null;
        reporter: {
          email: string;
          name: string;
        } | null;
      }>;
      total_count: number;
    },
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  // Defense-in-depth: route-level RBAC zostaje, guard na wejściu operacji
  // (parytet z admin/operations/* — operacja nie ufa, że została wywołana
  // wyłącznie spod admin route'a).
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // DECISION (nie usuwaj tego komentarza):
  // Clamp page/limit at the OPERATION boundary (not only at the route) so any
  // caller — including ones that bypass the route's own clamp — can't make
  // skip = (page-1)*limit overflow Postgres bigint OFFSET (-> unmapped HTTP 500).
  // Ceiling 10_000_000 mirrors PAGINATION_CEILING in http/query-params.utils;
  // kept inline here (a plain numeric guard) rather than importing the HTTP
  // query-parsing util into the domain layer. floor() because Prisma skip rejects
  // non-integer floats. Past-end page yields an empty list (200), not 500.
  // Number.isFinite FIRST (mirrors clampInt in http/query-params.utils): `??`
  // only catches null/undefined — a direct caller passing NaN/Infinity would
  // otherwise pass Math.max/min unchanged into skip:NaN -> Prisma DATABASE_ERROR.
  // Non-finite (NaN/±Infinity) collapses to the default (page 1 / limit 20).
  const PAGE_CEILING = 10_000_000;
  const clampPaging = (value: number, fallback: number, max: number): number =>
    Number.isFinite(value)
      ? Math.floor(Math.min(Math.max(value, 1), max))
      : fallback;
  const page = clampPaging(params.page ?? 1, 1, PAGE_CEILING);
  const limit = clampPaging(params.limit ?? 20, 20, 100);
  const skip = (page - 1) * limit;

  try {
    const where = params.status ? { status: params.status } : {};

    const [reports, total_count] = await DB_CLIENT.use.$transaction([
      DB_CLIENT.use.contentReport.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
        include: {
          gallery_record: {
            select: {
              asset_url: true,
              created_by_account_id: true,
              created_by_account: {
                select: {
                  created_by_user_id: true,
                },
              },
            },
          },
        },
      }),
      DB_CLIENT.use.contentReport.count({ where }),
    ]);

    // DECISION (nie usuwaj tego komentarza):
    // Autor zgłoszenia dociągany OSOBNYM zapytaniem, nie relacją. `reporter_id` jest
    // soft-FK (patrz DECISION przy modelu w schema.prisma): twarda kaskada kasowała
    // zgłoszenia razem z kontem zgłaszającego — również te PENDING, dotyczące treści,
    // która zostawała żywa, więc kolejka moderacji cicho gubiła sprawę. Skoro wiersz
    // przeżywa autora, odczyt musi umieć pokazać zgłoszenie BEZ niego; DTO od początku
    // dopuszcza `reporter: null`, a panel renderuje wtedy „N/A".
    // Jedno zapytanie na stronę wyników (nie na wiersz) — `in` po odfiltrowanych
    // identyfikatorach, więc koszt jest stały niezależnie od rozmiaru strony.
    const reporterIds = [...new Set(reports.map(r => r.reporter_id))];
    const reporters = reporterIds.length
      ? await DB_CLIENT.use.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const reporterById = new Map(
      reporters.map(u => [u.id, { email: u.email, name: u.name }])
    );

    // DECISION (nie usuwaj tego komentarza):
    // Prisma $Enums.ContentReportReason/Status === DTO ContentReportReason/Status
    // (re-eksport z generated DTO, strukturalnie identyczne literal unions). Bez
    // `as` castów — Prisma zwraca dokładnie te typy. Mapping zachowany tylko po to,
    // by spłaszczyć gallery_record (rozwinięcie zagnieżdżonego created_by_user_id);
    // reason/status przechodzą 1:1 bez .toLowerCase() (po F1 dedup fix).
    // Owner ACTIVE strikes for this page of reports — one grouped query over
    // the rolling window (expires_at > now), parity with
    // applyModerationStrike_IO response semantics. The monotonic
    // User.moderation_strikes counter is NOT used here: it never decays, while
    // moderation decisions (ban threshold) are made on ACTIVE strikes.
    const now = new Date();
    const ownerIds = [
      ...new Set(
        reports
          .map(r => r.gallery_record?.created_by_account?.created_by_user_id)
          .filter((id): id is string => id != null)
      ),
    ];
    const strikeGroups =
      ownerIds.length > 0
        ? await DB_CLIENT.use.moderationStrike.groupBy({
            by: ['user_id'],
            where: { user_id: { in: ownerIds }, expires_at: { gt: now } },
            _count: { _all: true },
          })
        : [];
    const strikesByOwner = new Map(
      strikeGroups.map(g => [g.user_id, g._count._all])
    );

    // DECISION (nie usuwaj tego komentarza) — finding C3 (contract-drift, K1):
    // Explicit field-pick zamiast `const { gallery_record, ...rest } = r; return { ...rest }`.
    // `...rest` spreadowal KAZDY pozostaly scalar ContentReport — w tym `resolved_by_id`
    // (soft-FK audit-trail kolumny, schema.prisma) — do kazdego itemu odpowiedzi, mimo ze
    // DTO ADMIN_GET_CONTENT_REPORTS.RESPONSE.reports[] go NIE deklaruje (over-return
    // wewnetrznego id moderatora). TS structural-assignability przepuszcza excess-propsy ze
    // spreadu (excess-property-check odpala tylko na swiezych literalach), a handler byl
    // bez <TRes> brandu (RESPONSE degradowal do unknown). Fix dwuczesciowy: (1) pick pol 1:1
    // z DTO tutaj, (2) handler dostal <REQUEST, RESPONSE> brand — od teraz kompilator lapie
    // przyszly drift. audit:dto sprawdza parytet klucza-rejestru, nie runtime-shape → nie
    // lapal tej klasy.
    const mappedReports = reports.map(r => {
      const ownerUserId =
        r.gallery_record?.created_by_account?.created_by_user_id ?? null;
      return {
        id: r.id,
        gallery_record_id: r.gallery_record_id,
        reporter_id: r.reporter_id,
        reason: r.reason,
        description: r.description,
        status: r.status,
        admin_note: r.admin_note,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
        gallery_record: r.gallery_record
          ? {
              asset_url: r.gallery_record.asset_url,
              created_by_account_id: r.gallery_record.created_by_account_id,
              gallery_record_owner_user_id: ownerUserId,
              owner_active_strikes:
                ownerUserId != null
                  ? (strikesByOwner.get(ownerUserId) ?? 0)
                  : 0,
            }
          : null,
        reporter: reporterById.get(r.reporter_id) ?? null,
      };
    });

    return success({ reports: mappedReports, total_count });
  } catch (error) {
    return databaseFailure('getContentReports', error);
  }
};
