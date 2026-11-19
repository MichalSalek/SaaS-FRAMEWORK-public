import crypto from 'crypto';
import { ENV_VARS } from '@app/environment/environment.config';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { IMPERSONATION_TIMEOUT_MS } from '@kernel/domain/admin/admin.config';
import { deleteSessionByToken_IO } from '@domain/user/operations/user-session.operations';

const HMAC_ALGORITHM = 'sha256';
const REF_ID_BYTES = 16;
const DEV_FALLBACK_SECRET =
  'dev-only-impersonation-hmac-secret-do-not-use-in-production';

const getSecret = (): string => {
  const secret = ENV_VARS.IMPERSONATION_HMAC_SECRET;
  if (secret) {
    return secret;
  }
  // DECISION: the fallback literal lives in the repository, so it is allowed only where no
  // outside client reaches the backend (DEVELOPMENT, STAGING). Every other mode, PREVIEW included,
  // fails closed: a token signed with a known literal can be forged by anyone who read it.
  if (
    ENV_VARS.NODE_ENV_MANUAL !== 'DEVELOPMENT' &&
    ENV_VARS.NODE_ENV_MANUAL !== 'STAGING'
  ) {
    throw new Error(
      'IMPERSONATION_HMAC_SECRET must be set outside development and staging'
    );
  }
  return DEV_FALLBACK_SECRET;
};

const sign = (refId: string, expiresAtMs: number): string =>
  crypto
    .createHmac(HMAC_ALGORITHM, getSecret())
    .update(`${refId}:${expiresAtMs}`)
    .digest('base64url');

const timingSafeStringEqual = (a: string, b: string): boolean => {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(a, 'utf-8');
  bufB.write(b, 'utf-8');
  return crypto.timingSafeEqual(bufA, bufB);
};

export type ImpersonationBackupRow = {
  ref_id: string;
  admin_user_id: string;
  backup_session_token: string;
  original_session_id: string;
  // DECISION: caller binding. The row remembers WHO may redeem it (the impersonated target on the
  // exact session minted for it). With only "caller is not the admin", any user who leaked the
  // opaque header could steal the MASTER_ADMIN session. Server-side only, never in the header.
  impersonated_user_id: string;
  impersonated_session_token: string;
  expires_at: Date;
};

/**
 * Issue a fresh opaque backup token for an admin starting impersonation.
 *
 * DECISION: one active impersonation per admin. A second `become-user` replaces the row, so the
 * first opaque token dies (its ref_id is gone) and an XSS cannot leak a stale one. The header
 * carries only an HMAC-bound ref_id; the admin session token stays in the DB.
 */
export const issueImpersonationBackup = async (params: {
  adminUserId: string;
  backupSessionToken: string;
  originalSessionId: string;
  // CALLER-BINDING (admin-impersonation-1): identity + session token of the
  // impersonated target. The redeem guards require the caller to match BOTH.
  impersonatedUserId: string;
  impersonatedSessionToken: string;
}): Promise<{ opaqueToken: string; expiresAt: Date }> => {
  const {
    adminUserId,
    backupSessionToken,
    originalSessionId,
    impersonatedUserId,
    impersonatedSessionToken,
  } = params;

  const refId = crypto.randomBytes(REF_ID_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + IMPERSONATION_TIMEOUT_MS);
  const expiresAtMs = expiresAt.getTime();
  const signature = sign(refId, expiresAtMs);
  const opaqueToken = `${refId}.${expiresAtMs}.${signature}`;

  // DECISION: read the prior row before the upsert and tear down the impersonated session it
  // pointed at; otherwise every re-become leaves the previous target session alive and redeemable
  // as a bearer for its full TTL, referenced by no row and never swept.
  // DECISION: the read and upsert run in a Serializable tx. Under Read Committed two concurrent
  // become-user calls by one admin both see no prior row and one minted session orphans; SSI
  // aborts the loser (40001), and adminBecomeUser_IO maps it via isSerializationConflict(). The
  // prior-session teardown runs after commit so the lock is not held during unrelated IO.
  let priorImpersonatedUserId: string | null = null;
  let priorImpersonatedSessionToken: string | null = null;

  await DB_CLIENT.use
    .$transaction(
      async tx => {
        const priorBackup = await tx.impersonationBackup.findUnique({
          where: { admin_user_id: adminUserId },
        });
        if (priorBackup) {
          priorImpersonatedUserId = priorBackup.impersonated_user_id;
          priorImpersonatedSessionToken =
            priorBackup.impersonated_session_token;
        }

        // Single active impersonation: upsert on the unique admin_user_id index.
        await tx.impersonationBackup.upsert({
          where: { admin_user_id: adminUserId },
          create: {
            ref_id: refId,
            admin_user_id: adminUserId,
            backup_session_token: backupSessionToken,
            original_session_id: originalSessionId,
            impersonated_user_id: impersonatedUserId,
            impersonated_session_token: impersonatedSessionToken,
            expires_at: expiresAt,
          },
          update: {
            ref_id: refId,
            backup_session_token: backupSessionToken,
            original_session_id: originalSessionId,
            impersonated_user_id: impersonatedUserId,
            impersonated_session_token: impersonatedSessionToken,
            expires_at: expiresAt,
          },
        });
      },
      { isolationLevel: 'Serializable' }
    )
    .catch(async (error: unknown) => {
      // DECISION: on ANY tx failure, not only 40001, tear down the session the caller minted
      // before calling us. On other errors the caller re-throws without cleanup, so a conditional
      // delete here would orphan a live impersonated session. Then re-throw (429 vs 500 upstream).
      await deleteSessionByToken_IO({
        payload: { id: impersonatedUserId, token: impersonatedSessionToken },
      });
      throw error;
    });

  // Tear down the prior impersonated session now that the backup row points at the
  // new one. Guarded by `!== impersonatedSessionToken` so a (degenerate) re-become
  // that somehow reuses the same token can't delete the session we just bound.
  // Scoped to the prior target's id + token (deleteMany), idempotent, best-effort.
  if (
    priorImpersonatedUserId !== null &&
    priorImpersonatedSessionToken !== null &&
    priorImpersonatedSessionToken !== impersonatedSessionToken
  ) {
    await deleteSessionByToken_IO({
      payload: {
        id: priorImpersonatedUserId,
        token: priorImpersonatedSessionToken,
      },
    });
  }

  return { opaqueToken, expiresAt };
};

/**
 * Refresh an existing backup: ROTATE its ref_id (mint a brand-new row, delete the
 * old one), returning a new opaque token bound to the new ref_id + expiration.
 *
 * DECISION: refresh ROTATES the ref_id. The token is self-contained and verify checks the HMAC
 * over its OWN embedded expiry, so merely bumping expires_at left every predecessor token
 * redeemable. There is no nonce column; the only way to kill an old token is to delete its ref_id.
 * The caller binding is carried forward, so the genuine target keeps working with the new token.
 */
export const refreshImpersonationBackup = async (params: {
  refId: string;
}): Promise<{ opaqueToken: string; expiresAt: Date } | null> => {
  const existing = await DB_CLIENT.use.impersonationBackup.findUnique({
    where: { ref_id: params.refId },
  });
  if (!existing) {
    // Row vanished (cleanup race or already deleted) — caller treats as invalid.
    return null;
  }

  const newRefId = crypto.randomBytes(REF_ID_BYTES).toString('base64url');
  const newExpiresAt = new Date(Date.now() + IMPERSONATION_TIMEOUT_MS);
  const expiresAtMs = newExpiresAt.getTime();
  const signature = sign(newRefId, expiresAtMs);
  const opaqueToken = `${newRefId}.${expiresAtMs}.${signature}`;

  try {
    // DECISION: DELETE before CREATE in one tx. admin_user_id is @unique and Postgres checks it
    // per statement, so creating the successor first violates the index. A failure rolls back to
    // the original row.
    await DB_CLIENT.use.$transaction([
      DB_CLIENT.use.impersonationBackup.delete({
        where: { ref_id: params.refId },
      }),
      DB_CLIENT.use.impersonationBackup.create({
        data: {
          ref_id: newRefId,
          admin_user_id: existing.admin_user_id,
          backup_session_token: existing.backup_session_token,
          original_session_id: existing.original_session_id,
          impersonated_user_id: existing.impersonated_user_id,
          impersonated_session_token: existing.impersonated_session_token,
          expires_at: newExpiresAt,
        },
      }),
    ]);
  } catch {
    // Row vanished between read and tx (cleanup/concurrent refresh race) — treat as
    // invalid; the caller rejects and the transaction rolled back (no partial state).
    return null;
  }

  return { opaqueToken, expiresAt: newExpiresAt };
};

/**
 * DECISION: a failed backup delete is non-fatal but NOT silent. A surviving row carries a live
 * admin session token while the response reports success, so it is logged as `error` for a
 * manual check. P2025 (row already gone) stays silent: both paths are idempotent.
 */
const reportBackupDeleteFailure = (operation: string, error: unknown): void => {
  if (isP2025(error)) {
    return;
  }
  reportIssueBackend({
    namespace: 'IMPERSONATION_BACKUP_DELETE_FAILED',
    message: `${operation}: could not delete the impersonation backup row — a row holding a live admin session token may still exist`,
    payload: {
      operation,
      error: error instanceof Error ? error.message : String(error),
    },
    mode: 'error',
  });
};

/**
 * Verify an opaque token (HMAC-then-DB lookup) and return the backup row.
 * Returns null for malformed, tampered, expired, or unknown tokens.
 *
 * DECISION: the timing-safe HMAC check runs BEFORE the DB lookup, so spraying ref_ids without
 * the secret never reaches Postgres.
 */
export const verifyImpersonationBackup = async (
  opaqueToken: string
): Promise<ImpersonationBackupRow | null> => {
  const parts = opaqueToken.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [refId, expiresAtStr, signature] = parts;
  if (!refId || !expiresAtStr || !signature) {
    return null;
  }

  const expiresAtMs = Number(expiresAtStr);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    return null;
  }

  // Cheap expiry pre-check before crypto (still HMAC-guarded so tampered
  // expires_at can't bypass — sign() is computed over the user-provided value).
  if (Date.now() > expiresAtMs) {
    return null;
  }

  const expectedSig = sign(refId, expiresAtMs);
  if (!timingSafeStringEqual(signature, expectedSig)) {
    return null;
  }

  const row = await DB_CLIENT.use.impersonationBackup.findUnique({
    where: { ref_id: refId },
  });
  if (!row) {
    return null;
  }

  // DB-side expiration enforcement (HMAC could have been forged with an old
  // long-TTL signature if the secret ever leaked; DB expires_at is the floor).
  if (Date.now() > row.expires_at.getTime()) {
    // Best-effort cleanup of expired row — non-fatal, but NOT silent (see the
    // reportBackupDeleteFailure DECISION).
    await DB_CLIENT.use.impersonationBackup
      .delete({ where: { ref_id: refId } })
      .catch(error =>
        reportBackupDeleteFailure('verifyImpersonationBackup.expired', error)
      );
    return null;
  }

  return {
    ref_id: row.ref_id,
    admin_user_id: row.admin_user_id,
    backup_session_token: row.backup_session_token,
    original_session_id: row.original_session_id,
    impersonated_user_id: row.impersonated_user_id,
    impersonated_session_token: row.impersonated_session_token,
    expires_at: row.expires_at,
  };
};

/**
 * Hard-delete a backup row by ref_id. Idempotent — missing row is a no-op.
 * Called on switch-back success and on irrecoverable validation failure.
 */
export const deleteImpersonationBackupByRefId = async (
  refId: string
): Promise<void> => {
  await DB_CLIENT.use.impersonationBackup
    .delete({ where: { ref_id: refId } })
    .catch(error =>
      reportBackupDeleteFailure('deleteImpersonationBackupByRefId', error)
    );
};

/**
 * Atomically CLAIM (consume) a backup row by ref_id, returning true only for the
 * single caller whose delete actually removed the row.
 *
 * DECISION: exactly-once redeem. Read-then-delete let two concurrent switch-backs both restore the
 * admin session and both write an audit row. `deleteMany` returns the count atomically, so only
 * the caller with count === 1 wins; the rest must reject without re-issuing the header or writing
 * another audit row.
 */
export const claimImpersonationBackupByRefId = async (
  refId: string
): Promise<boolean> =>
  DB_CLIENT.use.$transaction(async tx => {
    // DECISION: the impersonated session dies in the SAME tx as its backup row, session first. The
    // sensitive-command gate recognises impersonation by that row, so a session outliving it could
    // authenticate, find no row and run ungated.
    const row = await tx.impersonationBackup.findUnique({
      where: { ref_id: refId },
      select: { impersonated_session_token: true },
    });
    if (!row) {
      return false;
    }
    await tx.session.deleteMany({
      where: { token: row.impersonated_session_token },
    });
    const result = await tx.impersonationBackup.deleteMany({
      where: { ref_id: refId },
    });
    return result.count === 1;
  });

/**
 * Sweep expired backup rows. Used by the cleanup interceptor (24h cadence)
 * AND on every verify failure for the matching ref_id.
 */
export const sweepExpiredImpersonationBackups = async (): Promise<{
  deleted: number;
}> =>
  DB_CLIENT.use.$transaction(async tx => {
    // DECISION: an expired backup takes its impersonated session with it. The backup lives 12h,
    // the session longer; deleting only the row left an ungated, unstamped bearer on the user's
    // account.
    const expired = await tx.impersonationBackup.findMany({
      where: { expires_at: { lt: new Date() } },
      select: { ref_id: true, impersonated_session_token: true },
    });
    if (expired.length === 0) {
      return { deleted: 0 };
    }
    await tx.session.deleteMany({
      where: {
        token: { in: expired.map(row => row.impersonated_session_token) },
      },
    });
    const result = await tx.impersonationBackup.deleteMany({
      where: { ref_id: { in: expired.map(row => row.ref_id) } },
    });
    return { deleted: result.count };
  });
