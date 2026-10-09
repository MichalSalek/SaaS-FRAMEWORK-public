import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { SESSION_EXPIRES_IN_SECONDS } from '@kernel/application/auth/auth.config';
import { parseDeviceType } from '@app/auth/session/parse-device-type';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { IDType } from '@kernel/application/application.types';
import type { Session, User } from '@kernel/models/db_models.generated.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import type { GetCurrentUserOutput } from '@domain/user/user.types';
import { makeCurrentUser } from '@domain/user/user.utils.api';
import { getUser_IO } from './user-crud.operations';
import { revokeImpersonationOnEviction } from '@domain/admin/impersonation-eviction';
import { auth } from '@app/auth/better-auth/better-auth.config';

/**
 * Session Management Operations (Better Auth era).
 *
 * `getCurrentUser_IO` is the single chokepoint for request authentication.
 * It delegates session resolution entirely to Better Auth (`auth.api.getSession`),
 * which natively handles:
 *   - Bearer tokens (Authorization header, via the bearer() plugin)
 *   - Session cookies (OAuth flow)
 *   - Session refresh (configured via `session.updateAge` in better-auth.config.ts)
 *   - Expiration checks
 *
 * Manual session lookup, expiry checks, and refresh logic were removed in
 * WAVE 4 — Better Auth owns all of that now.
 *
 * The helpers below (`createManualSessionForUser_IO`, `deleteSessionByToken_IO`,
 * `deleteAllSessionsOfUser_IO`, `deleteSession_IO`, `getAllSessionsOfUser_IO`)
 * remain because they power custom admin impersonation (WAVE 5) and dev-login,
 * which bypass Better Auth's sign-in flow deliberately.
 */

export const getCurrentUserUndefinedReturnObject: GetCurrentUserOutput = {
  user: undefined,
  currentUser: undefined,
  session: undefined,
};

/**
 * Get current user from session (Better Auth — bearer token OR cookie).
 *
 * OPTIMIZATION: after BA returns a user id, we still hit our DB for the full
 * `UserWithRelations` shape (`minimal` relations) because the CurrentUser that
 * downstream permission wiring relies on needs `stylist_account` / `client_account`.
 * BA's `user` object only carries the core fields + additionalFields.
 */
export const getCurrentUser_IO = async (props: {
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<GetCurrentUserOutput> => {
  try {
    const result = await auth.api.getSession({
      headers: new Headers(props.req.headers as HeadersInit),
    });

    if (!result?.user?.id) {
      return getCurrentUserUndefinedReturnObject;
    }

    // Fetch UserWithRelations (stylist_account / client_account are required
    // for permission wiring and account guards downstream).
    const user = await getUser_IO({
      props: { id: result.user.id },
      withRelations: 'minimal',
    });

    if (!user) {
      return getCurrentUserUndefinedReturnObject;
    }

    const baSession = result.session as unknown as Record<string, unknown>;
    const toDateOrNow = (v: unknown): Date => {
      if (v instanceof Date) {
        return v;
      }
      if (typeof v === 'string' || typeof v === 'number') {
        const d = new Date(v);
        return isNaN(d.getTime()) ? new Date() : d;
      }
      return new Date();
    };
    const mappedSession: Session = {
      id: result.session.id,
      token: result.session.token,
      userId: user.id,
      // BA exposes `expiresAt` on its runtime shape; our Prisma column is
      // `expires` (mapped via `session.fields.expiresAt` in better-auth.config).
      expires: toDateOrNow(baSession.expiresAt ?? baSession.expires),
      ip_address:
        typeof baSession.ipAddress === 'string'
          ? baSession.ipAddress
          : typeof baSession.ip_address === 'string'
            ? baSession.ip_address
            : null,
      user_agent:
        typeof baSession.userAgent === 'string'
          ? baSession.userAgent
          : typeof baSession.user_agent === 'string'
            ? baSession.user_agent
            : null,
      device_type:
        typeof baSession.device_type === 'string'
          ? baSession.device_type
          : null,
      createdAt: toDateOrNow(baSession.createdAt),
      updatedAt: toDateOrNow(baSession.updatedAt),
    };

    return {
      user,
      currentUser: makeCurrentUser({ user, session: mappedSession }),
      session: mappedSession,
    };
  } catch (error) {
    reportIssueBackend({
      namespace: 'getCurrentUser_IO',
      message: 'Better Auth getSession failed',
      payload: error,
      mode: 'error',
    });
    return getCurrentUserUndefinedReturnObject;
  }
};

/**
 * Delete specific session by token.
 * Used internally for admin impersonation cleanup (WAVE 5).
 * For regular user logout, Better Auth's `/api/auth/sign-out` handles it.
 */
export const deleteSessionByToken_IO = async (props: {
  payload: { id: IDType; token: string };
}) => {
  await DB_CLIENT.use.session.deleteMany({
    where: {
      userId: props.payload.id,
      token: props.payload.token,
    },
  });
};

/**
 * Create a session row directly in the DB (dev-login + admin impersonation).
 * Bypasses Better Auth's sign-in flow on purpose — these are privileged
 * server-side operations, not user-initiated logins.
 */
export const createManualSessionForUser_IO = async ({
  id,
  ip,
  userAgent,
}: {
  id: User['id'];
  ip: string | null;
  userAgent: string | null;
}): Promise<OperationResult<Session, DatabaseError>> => {
  if (!id) {
    return failure({
      type: 'DATABASE_ERROR',
      operation: 'createManualSessionForUser: Cannot create session without id',
    });
  }

  const expires = new Date(Date.now() + 1000 * SESSION_EXPIRES_IN_SECONDS);
  const token = crypto.randomBytes(32).toString('hex');
  const deviceType = parseDeviceType(userAgent);

  try {
    const session = (await DB_CLIENT.use.session.create({
      data: {
        token,
        expires,
        userId: id,
        ip_address: ip,
        user_agent: userAgent,
        device_type: deviceType,
      },
    })) as Session;

    return success(session);
  } catch (error) {
    return databaseFailure('createManualSessionForUser_IO', error);
  }
};

// DECISION (nie usuwaj tego komentarza):
// SESJA IMPERSONACJI JEST NIEWIDOCZNA DLA WŁAŚCICIELKI KONTA. become-user mintuje sesję
// z userId = cel (admin działa PRZEZ nią), więc bez filtra cel widział ją w SESSION_GET_ALL
// jako „inne urządzenie" i mógł ją usunąć SESSION_DELETE_EXACTLY — to zrywało adminowi
// switch-back (backup wiąże powrót z impersonated_session_token), a komentarze become-user
// obiecują, że użytkownik impersonacji nie widzi. Ukrywamy sesje, których token jest
// impersonated_session_token ŻYWEGO wiersza ImpersonationBackup (expires_at > now): dokładnie
// tak długo, jak istnieje kontrakt powrotu. Po wygaśnięciu backupu powrotu już nie ma, a
// sesja (48h) staje się zwykłym obcym bearerem na koncie — wtedy MA być widoczna i usuwalna.
// Wyjątek: sesja, przez którą pyta sam wołający (admin w trakcie impersonacji), zostaje —
// admin widzi swoją bieżącą sesję jako is_current. Usunięcie ukrytej sesji = ta sama
// odpowiedź co nieznane id (success(null) → CANNOT_DELETE_SESSION), bez wyroczni istnienia.
// Czytamy tabelę inline (jak impersonation-eviction.ts), żeby nie domknąć cyklu modułów
// user → admin. Brak indeksu po impersonated_user_id jest świadomy: tabela ma najwyżej
// jeden wiersz na admina.
const hiddenImpersonationSessionTokens = async ({
  userId,
  viewerSessionToken,
  now,
}: {
  userId: string;
  viewerSessionToken: string | undefined;
  now: Date;
}): Promise<string[]> => {
  const rows = await DB_CLIENT.use.impersonationBackup.findMany({
    where: { impersonated_user_id: userId, expires_at: { gt: now } },
    select: { impersonated_session_token: true },
    take: 100,
  });
  return rows
    .map(row => row.impersonated_session_token)
    .filter(token => token !== viewerSessionToken);
};

const excludeTokens = (tokens: string[]): { token?: { notIn: string[] } } =>
  tokens.length > 0 ? { token: { notIn: tokens } } : {};

// DECISION (nie usuwaj tego komentarza):
// Format-gate cursora cuid (`isValidCursorFormat` w @kernel validation.utils — SSOT
// dla obu call-sites; pelne uzasadnienie input-robustness + istnienia-PK oracle tam).
// Tu, ponad ten kontrakt: operacja zwraca zwykly ksztalt paginacji (NIE OperationResult),
// a HTTP handler nalezy do innego klastra — nie mozemy stad zwrocic statusu 400 bez
// zmiany kontraktu i edycji handlera. Graceful-degradation (malformowany/cudzy cursor =>
// pierwsza strona) jest poprawnym, kompletnym fixem: zaden bit istnienia nie wycieka i
// klient z popsutym kursorem dostaje uzyteczna pierwsza strone zamiast bledu.

export const getAllSessionsOfUser_IO = async ({
  id,
  cursor,
  take = 50,
  viewerSessionToken,
}: Pick<User, 'id'> & {
  cursor?: string;
  take?: number;
  /** Token of the session the caller is using; never hidden from the caller. */
  viewerSessionToken?: string;
}): Promise<{ sessions: Session[]; nextCursor: string | null }> => {
  const effectiveTake = Math.min(Math.max(take, 1), 100);
  const now = new Date();
  // Impersonation sessions are hidden from the account owner — see the DECISION at
  // hiddenImpersonationSessionTokens. Applied to the cursor anchor too, so a hidden
  // session id behaves like a fabricated cursor (first page).
  const hiddenTokenFilter = excludeTokens(
    await hiddenImpersonationSessionTokens({
      userId: id,
      viewerSessionToken,
      now,
    })
  );

  // DECISION (nie usuwaj tego komentarza):
  // Existence-oracle hardening. Prisma `cursor` kotwiczy wiersz po PK PONAD CALA
  // tabela ZANIM zaaplikuje `where: { userId }` — `where` filtruje tylko zbior
  // wynikowy, nie istnienie kotwicy. Skutek: cudze (cuid ofiary) vs sfabrykowane
  // (nieistniejace) cursory daja rozny wynik => 1-bit oracle "czy ten session.id
  // istnieje gdziekolwiek". Fix: uzyj cursora TYLKO gdy (a) ma poprawny format i
  // (b) kotwica nalezy do wolajacego (composite WHERE id+userId) i (c) kotwica
  // nadal jest ZYWA (expires > now — spójnie z filtrem listy; cursor na wlasna
  // wygasla sesje = pierwsza strona, nieodroznialne od cursora-fake). W przeciwnym
  // razie ignoruj cursor i serwuj pierwsza strone — wtedy cursor-ofiary ==
  // cursor-fake == cursor-wlasny-odfiltrowany (nieodroznialne). Koszt: 1 dodatkowy
  // indexed PK lookup tylko gdy cursor jest podany (strony >1 sa rzadsze niz
  // strona 1) — akceptowalny.
  let anchorCursor: string | undefined = undefined;
  if (cursor && isValidCursorFormat(cursor)) {
    const owns = await DB_CLIENT.use.session.findFirst({
      where: {
        id: cursor,
        userId: id,
        expires: { gt: now },
        ...hiddenTokenFilter,
      },
      select: { id: true },
    });
    if (owns) {
      anchorCursor = cursor;
    }
  }

  const rows = (await DB_CLIENT.use.session.findMany({
    where: {
      userId: id,
      // Only LIVE sessions — expired rows are dead weight for the device list
      // (expiredSessionCleanupInterceptor deletes them anyway; Better Auth never
      // resurrects an expired session, it only checks expiry on read).
      expires: { gt: now },
      ...hiddenTokenFilter,
    },
    // Newest expiry first = most recently active device on top. Cursor field (id)
    // MUST be part of orderBy for stable pagination — `expires` is non-unique
    // (multiple sessions can share an expiry), so id is the tiebreaker preventing
    // cursor+skip from skipping/duplicating rows on page boundaries.
    orderBy: [{ expires: 'desc' }, { id: 'asc' }],
    take: effectiveTake + 1,
    ...(anchorCursor ? { cursor: { id: anchorCursor }, skip: 1 } : {}),
  })) as Session[];

  const hasMore = rows.length > effectiveTake;
  const sessions = hasMore ? rows.slice(0, effectiveTake) : rows;
  const nextCursor =
    hasMore && sessions.length > 0
      ? (sessions[sessions.length - 1]?.id ?? null)
      : null;

  return { sessions, nextCursor };
};

// DECISION (nie usuwaj tego komentarza):
// Identifier = Session.id (DB PK), nie token. Token NIGDY nie trafia do HTTP body
// (request) ani response (GET_ALL). Defense-in-depth: composite WHERE (id + userId)
// — nawet jesli atakujacy zna cudze session.id (np. wyciek z logow), to nie usunie
// cudzej sesji bo userId nie pasuje do auth context. Uzywamy deleteMany (nie delete)
// bo Prisma `delete()` wymaga unique constraint, a {id+userId} nie jest deklarowana
// jako composite unique — deleteMany jest atomowy, zwraca {count} (0 jesli no-match).
// Pre-fetch jednego wiersza tylko zeby zwrocic pelny Session do audit log.
export const deleteSession_IO = async ({
  session_id,
  id,
  viewerSessionToken,
}: {
  id: User['id'];
  session_id: string;
  /** Token of the session the caller is using; never hidden from the caller. */
  viewerSessionToken?: string;
}): Promise<OperationResult<Session | null, DatabaseError>> => {
  if (!session_id || !id) {
    return success(null);
  }

  try {
    // A live impersonation session is not the owner's to delete: it resolves exactly
    // like an unknown id (DECISION at hiddenImpersonationSessionTokens).
    const hiddenTokenFilter = excludeTokens(
      await hiddenImpersonationSessionTokens({
        userId: id,
        viewerSessionToken,
        now: new Date(),
      })
    );
    const row = (await DB_CLIENT.use.session.findFirst({
      where: {
        id: session_id,
        userId: id,
        ...hiddenTokenFilter,
      },
    })) as Session | null;

    if (!row) {
      return success(null);
    }

    const result = await DB_CLIENT.use.session.deleteMany({
      where: {
        id: session_id,
        userId: id,
        ...hiddenTokenFilter,
      },
    });

    if (result.count === 0) {
      return success(null);
    }

    return success(row);
  } catch (error: unknown) {
    if (isP2025(error)) {
      return success(null);
    }
    return databaseFailure('deleteSession', error);
  }
};

export const deleteAllSessionsOfUser_IO = async ({
  id,
}: Pick<User, 'id'>): Promise<
  OperationResult<{ deletedCount: number }, DatabaseError | ValidationError>
> => {
  if (!id) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'id',
      message: 'User id is required to delete sessions',
    });
  }

  try {
    const result = await DB_CLIENT.use.session.deleteMany({
      where: { userId: id },
    });
    // Eviction cleanup: "log out everywhere" by a mid-impersonation admin must also
    // tear down the orphaned impersonated (target) session + backup (connected-dots l2-7).
    await revokeImpersonationOnEviction(id);
    return success({ deletedCount: result.count });
  } catch (error) {
    return databaseFailure('deleteAllSessionsOfUser_IO', error);
  }
};
