/**
 * Newsletter pending-subscriber retention cleanup.
 *
 * Removes NewsletterSubscriber rows that never completed double opt-in
 * (is_active=false AND confirmed_at IS NULL) and are older than
 * NEWSLETTER_PENDING_RETENTION_DAYS. Without this, unconfirmed rows
 * (email + ip_address) would live forever — a GDPR data-minimisation gap.
 *
 * Pattern: 1:1 with cleanupOldAiCrawlerEvents_IO (capped batch + reportable result).
 *
 * DECISION (nie usuwaj tego komentarza):
 * 1. Rows with ANY NewsletterConsentEvent are NEVER deleted (`consent_events:
 *    { none: {} }`): the consent table is an append-only RODO Art. 30 audit
 *    trail with FK Restrict — a previously-confirmed subscriber who re-subscribed
 *    (pending state, confirmed_at nulled) must keep their row forever. Deleting
 *    it would either throw on the FK or destroy the audit trail.
 * 2. Cap NEWSLETTER_PENDING_CLEANUP_CAP per run keeps the sweep bounded on a
 *    request-driven interceptor; backlog drains over consecutive daily runs.
 * 3. Known accepted edge: `created_at` is the ORIGINAL row creation date and is
 *    not bumped on re-subscribe token rotation. A fresh re-subscribe on a
 *    never-confirmed row older than the retention window can be swept before
 *    the user clicks the new confirm link — they land on INVALID_TOKEN and can
 *    simply subscribe again. Accepted: no updated_at column, schema unchanged.
 * 4. deleteMany re-checks the pending predicates (not just id IN) so a row
 *    confirmed between findMany and deleteMany survives the race.
 */

import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

export const NEWSLETTER_PENDING_RETENTION_DAYS = 90;
export const NEWSLETTER_PENDING_CLEANUP_CAP = 1000;

export const cleanupStaleNewsletterPending_IO = async (): Promise<
  OperationResult<{ deleted: number }, DatabaseError>
> => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - NEWSLETTER_PENDING_RETENTION_DAYS);

    const stalePendingWhere = {
      is_active: false,
      confirmed_at: null,
      created_at: { lt: cutoff },
      consent_events: { none: {} },
    };

    const candidates = await DB_CLIENT.use.newsletterSubscriber.findMany({
      where: stalePendingWhere,
      select: { id: true },
      take: NEWSLETTER_PENDING_CLEANUP_CAP,
    });

    if (candidates.length === 0) {
      return success({ deleted: 0 });
    }

    const result = await DB_CLIENT.use.newsletterSubscriber.deleteMany({
      where: {
        id: { in: candidates.map(candidate => candidate.id) },
        ...stalePendingWhere,
      },
    });

    return success({ deleted: result.count });
  } catch (error) {
    return databaseFailure('cleanupStaleNewsletterPending', error);
  }
};
