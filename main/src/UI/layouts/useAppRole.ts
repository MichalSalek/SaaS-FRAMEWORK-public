import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { authClient } from '../../application/auth/better-auth-client';
import { getFromClientStorage } from '../../application/client-device-storage/clientStorage.possibilities.api';
import { useAuth } from '../contexts/AuthContext.composition';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { useSessionRoleId } from '../shared/hooks/useSessionRole';

/**
 * Drawer / bottom-nav role taxonomy. Wider than `AccountType` because admin
 * is its own UI bucket (admin tabs, admin drawer) regardless of underlying
 * account type.
 */
export type AppRole = 'stylist' | 'client' | 'admin';

interface AppRoleState {
  /**
   * Meaningful ONLY while `isRoleResolved`. Until then it reads 'client' as a
   * type-level placeholder; drawing it would show a stylist the client's
   * screens (and fire the client's queries: 403).
   */
  role: AppRole;
  /**
   * The active role is known (from the session, or from the account query
   * while the session has not arrived). Every consumer that renders something
   * role-specific waits for this.
   */
  isRoleResolved: boolean;
  /**
   * „Cannot tell yet”: the shell draws its neutral state (two shared tabs and
   * three empty slots, the role-less drawer). True before hydration (the
   * server and the first client render know neither the token nor the
   * session, and they must render the same thing) and, for a signed-in user,
   * until a role source answers. A hydrated guest is NOT unknown.
   */
  isRoleUnknown: boolean;
  isLoggedIn: boolean;
  isAdmin: boolean;
  /**
   * Better Auth session still resolving — `isAdmin`/`role` are NOT yet
   * authoritative. Consumers that act on non-admin (e.g. AdminLayout redirect)
   * MUST wait for this to be false to avoid bouncing a real admin during the
   * post-reload session-hydration window.
   */
  isSessionPending: boolean;
  /** Admin currently impersonating another user (Better Auth become-user). */
  isBecomeUser: boolean;
}

/**
 * Resolves the effective UI role for the layout.
 *
 *   1. Effective role = mapped from `accountType` (STYLIST → 'stylist',
 *      CLIENT → 'client'). Unknown is NOT a role: `isRoleResolved` is false
 *      and consumers show their neutral state.
 *   2. Admin: role_id === SystemRoleId.MASTER_ADMIN via `useSessionRoleId` (session first,
 *      cached account query second). No localStorage.
 *   3. Become-user: presence of the become-user token in storage (CUSTOM_HEADERS.becomeUser).
 *
 * SSR-safe: reads window storage only inside an effect; admin flag derives
 * reactively from the session hook (no first-render flash for already-cached
 * sessions).
 */
export function useAppRole(): AppRoleState {
  const { isLoggedIn, accountType } = useAuth();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const { asPath } = useRouter();
  const [isBecomeUser, setIsBecomeUser] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const roleId = useSessionRoleId();
  const isAdmin = roleId === SystemRoleId.MASTER_ADMIN;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    // Canonical storage read (sessionStorage-first + SSR-guard) instead of raw
    // window.localStorage/sessionStorage — getFromClientStorage owns the
    // become-user token lookup the same way every other call-site does.
    const becomeToken = getFromClientStorage({
      key: CUSTOM_HEADERS.becomeUser,
    });
    setIsBecomeUser(becomeToken !== null && becomeToken !== '');
    // DECISION: `asPath` is a dependency because the become-user token is
    // stamped by the HTTP interceptor outside React; neither `isLoggedIn` nor
    // `session` changes, so without it the impersonation banner never appeared
    // until a reload. Every become and switch-back ends in a navigation, so the
    // path is a reliable signal; the read is local storage, so it costs nothing.
  }, [isLoggedIn, session, asPath]);

  // DECISION: an unknown role is its own state (`isRoleResolved`), never a
  // default 'client': a stylist whose session fetch failed got the client bar,
  // dashboard and 403s until a reload. Do not restore a default role.
  const isRoleResolved = isAdmin || accountType !== null;
  let role: AppRole;
  if (isAdmin) {
    role = 'admin';
  } else if (accountType === AccountTypeValue.STYLIST) {
    role = 'stylist';
  } else {
    role = 'client';
  }

  return {
    role,
    isRoleResolved,
    isRoleUnknown: !isRoleResolved && (!isHydrated || isLoggedIn),
    isLoggedIn,
    isAdmin,
    isSessionPending,
    isBecomeUser,
  };
}
