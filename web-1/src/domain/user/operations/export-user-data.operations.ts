import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { exportNewsletterSubscription } from './export-newsletter.helper';
import {
  exportStylistData,
  exportClientData,
  COLLECTION_LIMIT,
} from './export-user-data.collectors';
import {
  collectSupportThreads,
  collectPairMessages,
} from './export-user-data.collectors.extra';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { ExportRateLimitedError } from '@kernel/domain/user-and-account/user-errors.types';
import type { CurrentUser } from '@kernel/models/user/user.types';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  EventLogTypeValue,
  AccountTypeValue,
} from '@kernel/models/db_models.generated.dto';
import { isSerializationConflict } from '@app/db/serialization-conflict';

const EXPORT_COOLDOWN_MS = TIME.MS_PER_DAY; // 24 hours
const EXPORT_VERSION = '1.0.0';

type ExportResponse = USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE'];

// Outcome of the rate-limit gate (discriminated union):
// - allowed: marker was written inside the tx; caller may proceed with the export
// - blocked: a prior export is still within the 24h cooldown (lastExportAt carries the timestamp)
type RateLimitGate =
  { allowed: true; markerId: string } | { allowed: false; lastExportAt: Date };

// DECISION: the cooldown read and the EventLog insert share one Serializable
// transaction. EventLog has no unique constraint on this marker, so a P2002
// catch is not the gate. A 40001 (isSerializationConflict) maps to
// EXPORT_RATE_LIMITED (429), the same type as an in-window cooldown.
async function reserveExportSlot(userId: string): Promise<RateLimitGate> {
  return DB_CLIENT.use.$transaction(
    async tx => {
      const lastExport = await tx.eventLog.findFirst({
        where: {
          created_by_user_id: userId,
          event: APP_EVENTS.INFO.USER.USER_DATA_EXPORTED,
        },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      });

      if (
        lastExport &&
        Date.now() - lastExport.created_at.getTime() < EXPORT_COOLDOWN_MS
      ) {
        return { allowed: false as const, lastExportAt: lastExport.created_at };
      }

      // Write the rate-limit marker BEFORE data collection, in this same
      // transaction as the check above. The marker id is returned
      // so the caller can COMPENSATE (release it) if collection then fails — otherwise
      // a transient collection error would burn the user's 24h window with no export.
      const marker = await tx.eventLog.create({
        data: {
          event: APP_EVENTS.INFO.USER.USER_DATA_EXPORTED,
          created_by_user_id: userId,
          event_type: EventLogTypeValue.ACCOUNT,
        },
        select: { event_log_id: true },
      });

      return { allowed: true as const, markerId: marker.event_log_id };
    },
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Compensating release of a reserved export slot. Called ONLY when data collection
 * fails AFTER the marker was committed — a transient collection error must not consume
 * the user's 24h cooldown when no export was actually delivered. Best-effort: a failed
 * delete just leaves the marker (the pre-fix behavior) and never masks the original
 * error. NOT called on the serialization-conflict path (the loser never wrote a marker)
 * nor on success.
 */
async function releaseExportSlot(markerId: string): Promise<void> {
  try {
    await DB_CLIENT.use.eventLog.delete({ where: { event_log_id: markerId } });
  } catch (error) {
    reportIssueBackend({
      namespace: 'exportUserData:releaseSlot',
      message:
        'Failed to release export rate-limit marker after a collection error',
      payload: { markerId, error },
      mode: 'warn',
    });
  }
}

export const exportUserData_IO = async ({
  currentUser,
}: {
  currentUser: CurrentUser;
}): Promise<
  OperationResult<ExportResponse, ExportRateLimitedError | DatabaseError>
> => {
  // Set ONLY after the rate-limit slot is committed. The closing catch uses it to
  // release the marker if data collection then fails, so a transient collection error
  // does not burn the user's 24h cooldown with no export delivered. Stays undefined on
  // the reserve-stage failure paths (no marker was written), so those never compensate.
  let reservedMarkerId: string | undefined;
  try {
    let gate: RateLimitGate;
    try {
      gate = await reserveExportSlot(currentUser.id);
    } catch (txError: unknown) {
      // Serialization conflict (SQLSTATE 40001): Serializable write-conflict with a concurrent
      // export tx (race ul-2). The other request won the slot; treat this loser as rate-limited
      // rather than a 500. We don't have the winner's exact marker timestamp here, so anchor the
      // cooldown at "now" (the concurrent export just happened) — the client gets a correct
      // ~24h nextAvailableAt.
      // DECISION: isSerializationConflict, not a bare `code === 'P2034'`: under @prisma/adapter-pg a 40001
      // surfaces as a DriverAdapterError (cause.kind='TransactionWriteConflict') WITHOUT `.code`, so a
      // P2034 check alone is dead code.
      if (isSerializationConflict(txError)) {
        const now = new Date();
        return failure({
          type: 'EXPORT_RATE_LIMITED',
          lastExportAt: now.toISOString(),
          nextAvailableAt: new Date(
            now.getTime() + EXPORT_COOLDOWN_MS
          ).toISOString(),
        });
      }
      throw txError;
    }

    if (!gate.allowed) {
      const nextAvailable = new Date(
        gate.lastExportAt.getTime() + EXPORT_COOLDOWN_MS
      );
      return failure({
        type: 'EXPORT_RATE_LIMITED',
        lastExportAt: gate.lastExportAt.toISOString(),
        nextAvailableAt: nextAvailable.toISOString(),
      });
    }

    // Slot committed — arm the compensation handle for the collection phase below.
    reservedMarkerId = gate.markerId;

    const isStylist = Boolean(currentUser.stylist_account);
    const isClient = Boolean(currentUser.client_account);
    const isDual = isStylist && isClient;
    const accountType = isStylist
      ? AccountTypeValue.STYLIST
      : AccountTypeValue.CLIENT;
    const data: Record<string, unknown> = {};

    // DD2-L4 r28 (extended): ALL independent reads run in one Promise.all — the two
    // account collectors PLUS the activity-log query and the newsletter lookup, which
    // previously serialized AFTER the account batch. None depend on each other; the only
    // ordering constraint is that assignment into `data` happens once they resolve.
    const stylistAccountId = currentUser.stylist_account?.account_id;
    const [
      stylistData,
      clientData,
      activityLog,
      newsletter,
      supportThreads,
      pairMessages,
    ] = await Promise.all([
      isStylist && stylistAccountId !== undefined
        ? exportStylistData(stylistAccountId)
        : null,
      isClient ? exportClientData(currentUser.id) : null,
      DB_CLIENT.use.eventLog.findMany({
        where: { created_by_user_id: currentUser.id },
        select: {
          event: true,
          created_at: true,
          event_type: true,
          client_ip: true,
          user_agent: true,
          location: true,
          language: true,
        },
        orderBy: { created_at: 'desc' },
        take: COLLECTION_LIMIT,
      }),

      exportNewsletterSubscription(currentUser.email),

      collectSupportThreads(currentUser.id, COLLECTION_LIMIT),

      collectPairMessages(currentUser.id, COLLECTION_LIMIT),
    ]);

    if (stylistData !== null) {
      Object.assign(
        data,
        isDual ? { stylist_account: stylistData } : stylistData
      );
    }
    if (clientData !== null) {
      Object.assign(data, isDual ? { client_account: clientData } : clientData);
    }

    data.activity_log = activityLog.map(log => ({
      event: log.event,
      event_type: log.event_type,
      created_at: log.created_at.toISOString(),
      ip_address: log.client_ip,
      user_agent: log.user_agent,
      location: log.location,
      language: log.language,
    }));

    data.support_threads = supportThreads;
    data.conversations = pairMessages;

    data.notification_preferences = {
      notifications_enabled: currentUser.notifications_enabled,
      email_marketing: currentUser.stylist_account?.email_marketing ?? null,
      email_trial_sequence:
        currentUser.stylist_account?.email_trial_sequence ?? null,
      terms_accepted_at: currentUser.terms_accepted_at?.toISOString() ?? null,
    };

    if (newsletter !== null) {
      data.newsletter_subscription = newsletter;
    }

    const exportPayload: ExportResponse = {
      export_version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      account_type: accountType,
      user: {
        email: currentUser.email,
        name: currentUser.name,
        created_at: currentUser.createdAt.toISOString(),
        account_type: accountType,
      },
      data,
    };

    reportIssueBackend({
      namespace: 'exportUserData',
      message: `Data exported for user ${currentUser.id} (${accountType})`,
      payload: { userId: currentUser.id, accountType },
      mode: 'info',
    });
    return success(exportPayload);
  } catch (error) {
    // Collection failed after the slot was reserved — release the marker so this
    // failed attempt does not consume the user's 24h window (best-effort; a failed
    // release just keeps the marker, the pre-fix behavior). undefined => the failure
    // was on the reserve stage itself (no marker committed) => nothing to release.
    if (reservedMarkerId !== undefined) {
      await releaseExportSlot(reservedMarkerId);
    }
    return databaseFailure('exportUserData', error);
  }
};
