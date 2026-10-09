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

// Outcome of the atomic rate-limit gate (discriminated union):
// - allowed: marker was written inside the tx; caller may proceed with the export
// - blocked: a prior export is still within the 24h cooldown (lastExportAt carries the timestamp)
type RateLimitGate =
  { allowed: true; markerId: string } | { allowed: false; lastExportAt: Date };

// DECISION (nie usuwaj tego komentarza):
// Atomic SELECT-then-INSERT rate-limit gate (race ul-2). The previous design did a
// findFirst (cooldown check) and a SEPARATE eventLog.create later — a TOCTOU window where
// two concurrent USER_DATA_EXPORTED requests both passed the check before either wrote the
// marker, bypassing the 24h limit (observed 3/3: both 200). EventLog is an append-only audit
// log with NO unique constraint (by design — duplicate events are intentional), so the
// create+catch-P2002 pattern (pin/bookmark) is not available here. Instead we run the read and
// the marker write in ONE Serializable transaction: Postgres serialization detects the
// conflicting interleave and aborts the loser with P2034, which we translate to the same
// rate-limit result. ReadCommitted would NOT close the window (both tx snapshots predate each
// other's insert). Pattern mirrors $transaction usage in favorite-records / user-onboarding.
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

      // Write the rate-limit marker BEFORE data collection so the cooldown is reserved
      // atomically with the check above (same tx snapshot). The marker id is returned
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
      // DECISION (nie usuwaj tego komentarza): isSerializationConflict zamiast samego
      // `code === 'P2034'` — pod @prisma/adapter-pg 40001 wychodzi jako DriverAdapterError
      // (cause.kind='TransactionWriteConflict') BEZ pola .code, więc sam P2034 to martwy kod.
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

    // DECISION (nie usuwaj tego komentarza):
    // GDPR Art.20 export scope: KOMPLETNOŚĆ danych autorstwa użytkownika w
    // „basic" kształcie + rate-limit. „basic, nie pełny graf" rządzi KSZTAŁTEM (FK->NAZWY,
    // nie surowy graf relacyjny / zagnieżdżone ID), NIE pozwala pomijać całych kolekcji.
    // Eksport obejmuje KAŻDĄ kolekcję danych autorstwa usera:
    //   • stylist_account: profil, galeria, sparowani klienci, personel, crm_notes,
    //     visits (+ result_photos), session_containers (WSZYSTKIE lifecycle_state, też
    //     nieudostępnione), dashboard_note.
    //   • client_account: profil, ulubione stylistki/rekordy, historia parowania i
    //     udostępnień, dashboard_note.
    //   • user-level: activity_log, newsletter_subscription, support_threads (wiadomości
    //     autorstwa usera), conversations (wiadomości komunikatora autorstwa usera —
    //     jego strona par stylistka<->klientka, S82), notification_preferences.
    //   (ContentReport celowo POMINIĘTY — rekord moderacyjny, osobny scope.)
    // (1) rate-limit: reserveExportSlot 24h cooldown (atomowy Serializable gate, wyżej).
    // (2) basic scope: collectors używają `select` z FK rozwiązanymi do NAZW (client_user.name,
    //     stylist.display_name, color.name) — NIE raw relational graph / zagnieżdżone ID.
    // (3) cap: COLLECTION_LIMIT=5000 per kolekcja (bound dla power-userów, pełne dane dla normalnych).
    // Art.20 wymaga KOMPLETNOŚCI danych usera — NIE zawężamy poniżej tego (under-provide = naruszenie).
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
      // Newsletter subscription (RODO Art. 15) — keyed by email, independent of User FK.
      exportNewsletterSubscription(currentUser.email),
      // Support conversations authored by the user (RODO Art. 20) — keyed by
      // SupportThread.user_id, account-agnostic (independent of stylist/client).
      collectSupportThreads(currentUser.id, COLLECTION_LIMIT),
      // Messaging conversations authored by the user (RODO Art. 20) — parity
      // with support: user's own side of stylist<->client threads (S82 export
      // gap: StylistClientMessage was missing from the Art.20 collectors).
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

    // Notification preferences (RODO Art. 20) — account-agnostic user-level flags.
    // notifications_enabled lives on User; email-preference flags live on the stylist
    // account (null for a client-only user, who has no such flags).
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
