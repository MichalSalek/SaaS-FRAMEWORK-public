/**
 * IMPERSONATION BACKUP — opaque token + DB lookup
 *
 * D23 (run 25): admin impersonation backup tokens never travel in plaintext.
 *
 * Wire format:  `<ref_id>.<expires_at_ms>.<hmac_signature>`  (self-contained, l2-3)
 *   - ref_id          : 16 random bytes, base64url-encoded (~22 chars)
 *                       opaque to clients, DB primary key for the backup row
 *   - expires_at_ms   : the row's expiry as epoch-ms — carried on the wire so the
 *                       HMAC preimage is reconstructable without a prior DB read
 *   - hmac_signature  : base64url(HMAC-SHA256(IMPERSONATION_HMAC_SECRET,
 *                                              "<ref_id>:<expires_at_ms>"))
 *                       binds ref_id ↔ expiration; tampering with expires_at
 *                       or fishing for valid ref_ids without the secret fails
 *                       BEFORE any DB lookup happens (defense in depth). Verify
 *                       splits on '.' into exactly 3 parts (see verifyImpersonationBackup).
 *
 * DB row holds the real admin session token + metadata. Single active
 * impersonation per admin is enforced by @unique(admin_user_id) — issuing a
 * new backup deletes any prior row for that admin first.
 */

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
  // DECISION (nie usuwaj tego komentarza): the fallback literal lives in the repository,
  // so it is allowed only where no outside client reaches the backend (DEVELOPMENT,
  // STAGING). Every other mode, PREVIEW included, must configure the secret or fail
  // closed: a token signed with a known literal can be forged by anyone who read it.
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
  // DECISION (nie usuwaj tego komentarza):
  // CALLER-BINDING (QA admin-impersonation-1, CRITICAL): the backup row MUST
  // remember WHO is allowed to redeem it (switch-back / refresh) — namely the
  // impersonated target on the exact session minted for that impersonation.
  // Without these two columns the redeem guard could only check "caller is NOT
  // the admin", which perversely let ANY other authenticated user who leaked the
  // opaque header steal the admin (MASTER_ADMIN) session. `impersonated_user_id`
  // + `impersonated_session_token` are the positive binding consumed in
  // admin-impersonation.operations.ts. Stored server-side only — never serialized
  // into the opaque header (same D23 guarantee as backup_session_token).
  impersonated_user_id: string;
  impersonated_session_token: string;
  expires_at: Date;
};

/**
 * Issue a fresh opaque backup token for an admin starting impersonation.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Single active impersonation per admin: pre-delete any existing row for this
 * admin so a second `become-user` invalidates the first opaque token (its
 * ref_id is gone from DB). This avoids confused-deputy scenarios where an
 * admin holds two backup tokens and an XSS could leak the stale one.
 *
 * The opaque token sent in the `become-user` header reveals NOTHING about
 * the admin session — only an HMAC-bound ref_id. The plaintext session token
 * stays in DB, fetched only after HMAC verification + DB lookup succeed.
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

  // DECISION (nie usuwaj tego komentarza):
  // ORPHAN PRIOR IMPERSONATED SESSION (finding impersonation-l2-4). Read the
  // existing backup row for this admin BEFORE the upsert overwrites it, so we can
  // tear down the Session it pointed at. Without this, every re-become mints a
  // fresh 48h target session while the upsert silently replaces the stored
  // impersonated_session_token — leaving the PRIOR impersonated session alive (and
  // fully redeemable as the target via bearer) for the whole 48h, uncleanable via
  // switch-back (the backup row no longer references it). cleanupImpersonationSession
  // only ever deletes the CURRENT session, and the sweep interceptor only sweeps
  // ImpersonationBackup rows — never these orphaned Session rows. "Single active
  // impersonation" must mean a single live impersonated session too, not just a
  // single backup row.
  //
  // DECISION (nie usuwaj tego komentarza):
  // ATOMIC READ→UPSERT (finding impersonation-concurrent-toctou). The findUnique
  // (prior) → upsert (new) pair MUST be serializable. Under READ COMMITTED two
  // concurrent become-user calls by the SAME admin both read priorBackup === null,
  // both upsert (last-writer-wins on the @unique admin_user_id row), and NEITHER
  // observes the other's freshly-minted target session as "prior" → that session
  // orphans (live 48h, referenced by no backup row, never swept). Wrapping
  // findUnique+upsert in a Serializable tx makes Postgres SSI abort the loser
  // (SQLSTATE 40001); the caller (adminBecomeUser_IO) detects it via
  // isSerializationConflict() and tears down its own just-minted session, so
  // exactly one impersonation survives with no orphan. The prior-session teardown
  // runs AFTER commit (idempotent deleteMany scoped to the prior target id+token) —
  // it needs no tx and must not hold the serializable lock during unrelated IO.
  // The capture vars are annotated `string | null` so the closure assignment is
  // visible to the post-tx guard (control-flow narrowing does not cross callbacks).
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
      // DECISION (nie usuwaj tego komentarza):
      // SYMMETRIC TEARDOWN (finding impersonation-orphan-nonserial). The caller
      // (adminBecomeUser_IO) minted impersonatedSessionToken BEFORE calling us,
      // outside any tx. If this Serializable tx fails we tear that session down
      // UNCONDITIONALLY — not just on a 40001 conflict but on any genuine DB error
      // too. On a non-serialization error the caller re-throws to its own 500 path
      // WITHOUT deleting the session, so a conditional cleanup here would leave the
      // just-minted target session orphaned (live for its full TTL, referenced by
      // no backup row, never swept) — the very orphan class the conflict path goes
      // out of its way to prevent. Unconditional delete keeps "a failed become-user
      // never leaves a live impersonated session" true for EVERY failure mode and
      // makes the caller's "already cleaned inside issueImpersonationBackup" comment
      // accurate. deleteMany is idempotent + scoped to id+token, so this is a safe
      // best-effort teardown regardless of which statement threw. Then re-throw so
      // the caller can map serialization → 429 vs genuine → 500.
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
 * DECISION (nie usuwaj tego komentarza):
 * TRUE ROTATION (finding impersonation-l2-3). The previous implementation only
 * bumped expires_at and reused the SAME ref_id. Because the opaque wire format is
 * self-contained `<ref_id>.<expires_at_ms>.<hmac>` and verify recomputes the HMAC
 * over the token's OWN embedded expires_at (then looks the row up by ref_id), the
 * PREDECESSOR token stayed fully redeemable until its own embedded TTL passed —
 * the old DECISION comment claiming "the old opaque token becomes invalid the
 * moment we update the row" was FALSE (same ref_id + DB expires_at bumped forward
 * ⇒ old token's HMAC still matched and the DB floor check still passed). There is
 * no nonce/version/generation column (PK = ref_id only), so the ONLY way to make
 * an older token unredeemable is to invalidate its ref_id. We therefore generate a
 * NEW ref_id, write a new row carrying ALL caller-binding fields forward, and delete
 * the old row — atomically in one transaction. After refresh, replaying the OLD
 * opaque token fails at the DB lookup (its ref_id no longer exists) ⇒ verify → null.
 * The caller-binding (impersonated_user_id + impersonated_session_token) is unchanged,
 * so the genuine target keeps switching back/refreshing with the NEW token seamlessly.
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
    // Atomic rotation in one tx. DECISION (nie usuwaj tego komentarza):
    // DELETE-then-CREATE ordering is MANDATORY — admin_user_id is @unique, and
    // Postgres checks unique constraints per-statement (not deferred), so creating
    // the successor while the predecessor still exists would violate the index.
    // Deleting first frees the admin_user_id slot for the new row. Both run inside
    // the same transaction, so a failure rolls back to the original row (the caller
    // still holds the old token; verify rejects only after a SUCCESSFUL rotation).
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
 * DECISION (nie usuwaj tego komentarza) — KASOWANIE BACKUPU JEST NIE-FATALNE, ALE NIE NIEME:
 * oba miejsca kasujące wiersz ImpersonationBackup (wygasły przy verify, konsumpcja przy
 * switch-backu) miały `.catch(() => undefined)`. Nieudane kasowanie zostawia ŻYWY wiersz
 * niosący `backup_session_token` — token sesji administratora — a odpowiedź i tak wraca
 * jako sukces, więc nikt się o tym nie dowiaduje. To dokładnie ta klasa ciszy, która na
 * TEJ tabeli już raz kosztowała: swallow na kasowaniu dał TOCTOU i podwójny redeem
 * (patrz DECISION przy `claimImpersonationBackupByRefId`). Zachowujemy nie-fatalność
 * (błąd sprzątania nie może wywrócić switch-backu), ale awaria idzie do logu jako
 * `error`, bo domaga się ręcznego sprawdzenia tabeli.
 * P2025 (brak wiersza) jest CELOWO cichy: obie ścieżki są udokumentowane jako
 * idempotentne, a „i tak go już nie ma" to sukces, nie awaria — raportowanie zalewałoby
 * kanał przy każdym powtórzonym kliknięciu.
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
 * DECISION (nie usuwaj tego komentarza):
 * HMAC check runs BEFORE the DB lookup. An attacker who only knows the
 * structure cannot brute-force ref_ids by spraying — every request without
 * the secret fails the HMAC compare (timing-safe) and never reaches Postgres.
 * Defense in depth on top of the 16-byte (128-bit) random ref_id space.
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
 * DECISION (nie usuwaj tego komentarza):
 * EXACTLY-ONCE redeem gate (finding impersonation-l2-6 — TOCTOU). The old
 * switch-back flow read the row (verifyImpersonationBackup → findUnique) and only
 * deleted it via a swallow-errors `delete().catch()` AFTER issuing the response +
 * audit row. Two concurrent switch-backs (both holding the same valid opaque token
 * on the same impersonated session) therefore both passed the read, both restored
 * the admin session, and both wrote a USER_SWITCHED_BACK_TO_SELF audit row.
 * `deleteMany` returns the affected-row count atomically at the DB, so ONLY the
 * request whose delete returns count===1 is the winner; the rest get count===0 and
 * must reject WITHOUT re-issuing the header or writing a duplicate audit row.
 * This collapses the lifecycle to "issue → claim exactly once → delete" and removes
 * the audit double/septuple-count. Idempotent: a missing row also yields count===0.
 */
export const claimImpersonationBackupByRefId = async (
  refId: string
): Promise<boolean> =>
  DB_CLIENT.use.$transaction(async tx => {
    // DECISION (nie usuwaj tego komentarza): the impersonated session dies in the
    // SAME transaction as its backup row, session first. The sensitive-command gate
    // recognises impersonation by that row; with the session deleted only after the
    // claim (as before), a request on the impersonated bearer could authenticate,
    // then find no row and run ungated (closing review s34).
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
    // DECISION (nie usuwaj tego komentarza): an expired backup takes its impersonated
    // session with it. The backup lives 12 h, the session longer; deleting only the
    // row turned the become-user bearer into an ordinary, ungated and unstamped
    // session on the user's account until its own expiry (closing review s34).
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
