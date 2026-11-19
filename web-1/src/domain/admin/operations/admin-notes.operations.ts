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
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { AdminContracts } from '@kernel/domain/admin/admin.contracts';

type AdminHandlerData<K extends keyof AdminContracts> = ContractHandlerResponse<
  AdminContracts[K]
>;
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';

// DECISION: a domain-level cap on note length (VALIDATION_LENGTHS.ADMIN_DASHBOARD_NOTE_MAX).
// Notes are append-only with no prune endpoint, and without it the only limit is Next's 1MB
// bodyParser. The validator rejects first with a clean 400; this guard holds regardless of wiring.
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
    AdminHandlerData<'GET_NOTES'>,
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
      // DECISION: `id desc` breaks ties. Two writes in the same millisecond share `created_at`,
      // and which one is "main" (output[0]) would then depend on heap order. setMainNote
      // re-stamps created_at, so this matters only for same-ms collisions.
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: QUERY_LIMITS.ADMIN_LIST_DEFAULT,
    });

    // Explicit projection: the version list is metadata (id, date, length); full `notes` of
    // every version would grow the response with the whole history.
    const versions: AdminHandlerData<'GET_NOTES'>['versions'] = output.map(
      el => ({
        id: el.id,
        created_at: el.created_at,
        length: String(el.notes.length),
      })
    );

    // DECISION: a given `requestedId` is resolved with findUnique over the whole table, not
    // output.find() in the take window. Falling back to the newest version silently returned
    // another version for an unknown id or one outside the window; now it is a 404, like
    // setMainNote (P2025). Without requestedId the newest version is returned.
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

  // Domain-level length cap (storage abuse); see the DECISION at ADMIN_NOTE_MAX_LENGTH at
  // the top of the file. A clean 400 VALIDATION_FAILED instead of a silent store (<1MB) or
  // the raw framework 413 (>1MB bodyParser).
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

    // Notes are append-only versions, so the audit row records a create with the length only;
    // the content lives in AdminNote.
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

    // Tagged 'set_main' to tell a promotion apart from create_version in audit reads.
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
