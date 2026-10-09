import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetNotFoundError,
} from '@kernel/domain/admin/admin-errors.types';

import { isP2025 } from '@app/db/prisma-error';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';

// DECISION (nie usuwaj tego komentarza):
// admin-notes-2 — domowy cap długości treści noty (storage-abuse guard). Bez tego
// jedyną granicą jest frameworkowy bodyParser 1MB (default Next.js), nie intencjonalna
// polityka — admin może zapisać ~1MB tekstu/wersję, append-only bez prune endpointu.
// SSOT capu = VALIDATION_LENGTHS.ADMIN_DASHBOARD_NOTE_MAX w
// .shared-kernel/policies/validation.config.ts (ten guard = defense-in-depth na
// warstwie domeny; walidator admin-notes.validation.ts łapie to wcześniej i czyściej
// jako 400 VALIDATION_FAILED, ale guard egzekwuje cap niezależnie od wiringu walidatora).
const ADMIN_NOTE_MAX_LENGTH = VALIDATION_LENGTHS.ADMIN_DASHBOARD_NOTE_MAX;

/**
 * Get all note versions, optionally return specific version by ID
 */
export const getNotes_IO = async ({
  requestedId,
  currentUser,
}: {
  requestedId?: string | undefined;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    ADMIN_DTO_API_V1['GET_NOTES']['RESPONSE'],
    AdminInsufficientPermissionsError | AdminTargetNotFoundError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  try {
    const output = await DB_CLIENT.use.adminNote.findMany({
      select: { id: true, notes: true, created_at: true },
      // DECISION (nie usuwaj tego komentarza):
      // admin-notes-1 — wtórny klucz sortowania `id desc` jako tie-breaker. Dwa zapisy
      // w tej samej milisekundzie (częste pod równoległym ruchem) dawały równy
      // `created_at`, więc który rekord jest output[0] ("main") zależało od fizycznej
      // kolejności heapu Postgresa (plan zapytania / VACUUM), nie od intencji.
      // `id desc` czyni "main" deterministycznym przy kolizji ms. setMainNote re-stampuje
      // `created_at = new Date()`, więc świeżo promowana wersja i tak wygrywa po
      // pierwszym kluczu w normalnym flow; tie-break dotyczy tylko rzadkiej kolizji
      // dwóch promocji w tej samej ms. Kanoniczna alternatywa (is_main Boolean + atomic
      // $transaction jak w Policy) wymaga zmiany schema.prisma — poza zakresem tego fixu.
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: QUERY_LIMITS.ADMIN_LIST_DEFAULT,
    });

    // DECISION (nie usuwaj tego komentarza):
    // Projekcja JAWNA zamiast `...el`. Spread wnosił do listy wersji pełne `notes`
    // każdego wpisu, mimo że kontrakt (i panel) opisują tę listę jako METADANE:
    // identyfikator, datę i długość. Treść jest potrzebna wyłącznie dla JEDNEJ
    // wybranej wersji (`resolvedNotes` niżej), więc `notes: true` zostaje w select,
    // ale nie ma prawa wyjść w tablicy — inaczej odpowiedź rośnie liniowo z historią
    // notatek admina, a każda wersja jedzie po sieci tylko po to, żeby policzyć
    // z niej `length`.
    const versions: ADMIN_DTO_API_V1['GET_NOTES']['RESPONSE']['versions'] =
      output.map(el => ({
        id: el.id,
        created_at: el.created_at,
        length: String(el.notes.length),
      }));

    // DECISION (nie usuwaj tego komentarza):
    // admin-notes-3 — gdy podano konkretny `requestedId`, rozstrzygamy istnienie
    // autorytatywnie przez findUnique (cała tabela), NIE przez output.find() w oknie
    // take:100. Poprzednio `notes: maybeFoundById?.notes ?? output[0]?.notes` cicho
    // spadało do najnowszej wersji dla nieistniejącego id ORAZ dla prawdziwego id spoza
    // okna — wołający "czytał wersję X", a dostawał Y bez sygnału (false-positive read).
    // Teraz: requestedId podany + nie istnieje → 404 (ADMIN_TARGET_NOT_FOUND), spójnie
    // z setMainNote (P2025). Brak requestedId → default do output[0] (zachowane).
    let resolvedNotes: string;
    if (requestedId !== undefined) {
      const requestedNote = await DB_CLIENT.use.adminNote.findUnique({
        where: { id: requestedId },
        select: { notes: true },
      });
      if (requestedNote === null) {
        return failure({
          type: 'ADMIN_TARGET_NOT_FOUND',
          targetId: requestedId,
          targetType: 'RECORD',
        });
      }
      resolvedNotes = requestedNote.notes;
    } else {
      resolvedNotes = output[0]?.notes ?? '';
    }

    reportIssueBackend({
      namespace: 'getNotes',
      message: `Fetched ${output.length} note versions${requestedId ? ` (requested ID: ${requestedId})` : ''}`,
      payload: { version_count: output.length, requested_id: requestedId },
      mode: 'info',
    });

    return success({
      notes: resolvedNotes,
      versions,
    });
  } catch (error) {
    return databaseFailure('getNotes', error);
  }
};

/**
 * Save a new note version
 */
export const saveNote_IO = async ({
  notes,
  currentUser,
}: {
  notes: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    { note_id: string },
    AdminInsufficientPermissionsError | ValidationError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // admin-notes-2 — domowy cap długości (storage-abuse). Patrz DECISION przy
  // ADMIN_NOTE_MAX_LENGTH na górze pliku. Czysty 400 VALIDATION_FAILED zamiast
  // cichego store (<1MB) lub surowego frameworkowego 413 (>1MB bodyParser).
  if (notes.length > ADMIN_NOTE_MAX_LENGTH) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'notes',
      message: `Note exceeds maximum length of ${ADMIN_NOTE_MAX_LENGTH} characters`,
    });
  }

  try {
    const createdNote = await DB_CLIENT.use.adminNote.create({
      data: { notes },
    });

    reportIssueBackend({
      namespace: 'saveNote',
      message: `Saved new note version (${notes.length} characters)`,
      payload: { note_length: notes.length },
      mode: 'info',
    });

    // DECISION (nie usuwaj tego komentarza):
    // D4 — Admin notes versioned (append-only), no before_value (immutable history).
    // Capture note_length jako rough audit metric. Full content w AdminNote table.
    // saveNote tworzy NOWĄ wersję (append), więc to "create" semantics nie "update".
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.NOTE_SET,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: {
        created_by_user_id: currentUser.id,
      },
      eventPayloadToStringify: {
        note_id: createdNote.id,
        operation: 'create_version',
        note_length: notes.length,
      },
    });

    return success({ note_id: createdNote.id });
  } catch (error) {
    return databaseFailure('saveNote', error);
  }
};

/**
 * Set a note as main (update its created_at to now)
 */
export const setMainNote_IO = async ({
  noteId,
  currentUser,
}: {
  noteId: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    undefined,
    AdminInsufficientPermissionsError | AdminTargetNotFoundError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    await DB_CLIENT.use.adminNote.update({
      data: {
        created_at: new Date(),
      },
      where: { id: noteId },
    });

    reportIssueBackend({
      namespace: 'setMainNote',
      message: `Set note ${noteId} as main note`,
      payload: { note_id: noteId },
      mode: 'info',
    });

    // DECISION (nie usuwaj tego komentarza):
    // D4 — setMainNote = "promote version to current". Operation jest re-tagged jako
    // 'set_main' żeby rozróżnić w audit reads od saveNote create_version. note_id
    // wskazuje promowaną wersję.
    await writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.ADMIN.NOTE_SET,
      eventLogType: EventLogTypeValue.ADMIN,
      meta: {
        created_by_user_id: currentUser.id,
      },
      eventPayloadToStringify: {
        note_id: noteId,
        operation: 'set_main',
      },
    });

    return success(undefined);
  } catch (error) {
    if (isP2025(error)) {
      // Prisma "record to update not found" — promote-to-main on a non-existent
      // note id. Surface 404 instead of a generic 500. targetType RECORD matches
      // the convention used by updateColor/updateTrait existence checks.
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: noteId,
        targetType: 'RECORD',
      });
    }
    return databaseFailure('setMainNote', error);
  }
};
