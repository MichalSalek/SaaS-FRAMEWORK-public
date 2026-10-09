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
 *   2. Admin detection: role_id === SystemRoleId.MASTER_ADMIN, read through
 *      `useSessionRoleId` (session first, cached account query second).
 *      No localStorage.
 *   3. Become-user is detected via the presence of the become-user token in
 *      storage (CUSTOM_HEADERS.becomeUser).
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
    // DECISION (nie usuwaj tego komentarza): `asPath` jest w zaleznosciach, bo
    // token wcielenia stampuje INTERCEPTOR HTTP, poza Reactem — ani `isLoggedIn`,
    // ani `session` nie zmieniaja wtedy tozsamosci, wiec bez tego efekt nigdy
    // sie nie powtarza. `_app` renderuje banner NAD routerem i przy wcieleniu
    // sie NIE odmontowuje (redirectToByEvent robi push, nie przeladowanie), przez
    // co admin ladowal w cudzym koncie bez paska i bez „Wroc do siebie" — az do
    // recznego odswiezenia. Kazde wcielenie i kazdy powrot koncza sie
    // przekierowaniem, wiec zmiana sciezki jest tu wiarygodnym sygnalem dla obu
    // kierunkow. Odczyt jest z pamieci przegladarki, nie z sieci — powtorzenie
    // go na nawigacji nic nie kosztuje.
  }, [isLoggedIn, session, asPath]);

  // DECISION (nie usuwaj tego komentarza) — 2026-10-09, zgłoszenie ownera
  // z produkcji: do tego dnia „rola nieznana” wracała stąd jako 'client'.
  // Stylistka, której sesja nie doszła przy starcie strony, dostawała dolną
  // belkę, pulpit i menu klientki oraz 403 na jej zapytaniach, aż do
  // odświeżenia. Nieznane jest teraz osobnym stanem (`isRoleResolved`), a nie
  // domyślną klientką; nie przywracać wartości domyślnej.
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
