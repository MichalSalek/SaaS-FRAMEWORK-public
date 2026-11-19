// MaintenanceGate: render-null controller of maintenance mode. The banner
// (`MaintenanceBanner`) warns of downtime OVER the running app; this gate closes the door: with
// `MAINTENANCE_MODE=true` traffic goes to `/maintenance`. The two knobs are separate on purpose.
//
// DECISION: (1) ADMIN PASSES: the knob is switched off from the admin panel. The login path stays
// in ALWAYS_OPEN, but the maintenance page shows no link to it (owner). (2) WAIT FOR THE SESSION
// (`isSessionPending` from `useAppRole`): right after a hard reload the admin is still
// unrecognised and would be thrown onto the page. (3) THIS IS NOT SECURITY: the redirect is
// client-side because static pages are prerendered and the project has no middleware (see
// `_document.tsx`, proxy.ts); data is protected by RBAC at the API. (4) THE BACKEND STAYS OPEN, or
// the admin could not reverse the knob. (5) THE RETURN FROM STRIPE PASSES: a redirect would eat
// `session_id` and the user would see a wrench instead of the confirmation. (6) The `?authCode`
// exchange needs NO pass: `AuthProvider` sits ABOVE and renders its own fallback during the
// exchange (DECISION in AuthContext), so this component does not exist then; a condition on
// `authCode` would be dead code posing as protection.

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ROUTES_FRONT,
  ROUTES_FRONT_APP,
} from '@kernel/domain/routing/routing.config';
import { useMaintenanceMode } from './hooks/useMaintenanceMessage';
import { useAppRole } from '../../layouts/useAppRole';

/** Routes that must keep working in maintenance mode too. */
const ALWAYS_OPEN: readonly string[] = [
  ROUTES_FRONT.MAINTENANCE,
  ROUTES_FRONT.USER_LOG,
  ROUTES_FRONT_APP.CHECKOUT_RETURN,
];

export function MaintenanceGateComposition(): null {
  const isMaintenance = useMaintenanceMode();
  const { isAdmin, isSessionPending } = useAppRole();
  const router = useRouter();
  const { pathname, replace } = router;

  useEffect(() => {
    // Mode lifted while the user sits on the downtime page: she cannot leave on her
    // own (the page has no navigation by design), so send her back to the start.
    // The admin is left alone: he goes there to see what others see.
    // `null` (config never read) keeps the product open but is NOT a lifted
    // mode: only a confirmed `false` takes the visitor off the downtime page.
    if (isMaintenance !== true) {
      if (
        isMaintenance === false &&
        pathname === ROUTES_FRONT.MAINTENANCE &&
        !isAdmin &&
        !isSessionPending
      ) {
        void replace(ROUTES_FRONT.HOME);
      }
      return;
    }
    if (isSessionPending || isAdmin) {
      return;
    }
    if (ALWAYS_OPEN.includes(pathname)) {
      return;
    }
    void replace(ROUTES_FRONT.MAINTENANCE);
  }, [isMaintenance, isAdmin, isSessionPending, pathname, replace]);

  return null;
}
