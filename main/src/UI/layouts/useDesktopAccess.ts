import { useEffect, useState } from 'react';
import { useDevModeStore } from '../../application/stores/devMode.store';
import { ENV_VARS } from '../../application/environment/environment.config';
import {
  resolveDesktopAccess,
  type DesktopAccessDecision,
  type ManualEnv,
} from '../../application/policies/desktop-access.policy';

interface DesktopAccessInputs {
  /** True when the current account is admin. */
  isAdmin: boolean;
  /** True when an admin is impersonating another user. */
  isBecomeUser: boolean;
}

const KNOWN_ENVS: ReadonlyArray<ManualEnv> = [
  'DEVELOPMENT',
  'STAGING',
  'PREVIEW',
  'PRODUCTION',
];

function normalizeEnv(raw: string | undefined): ManualEnv {
  const upper = (raw ?? 'DEVELOPMENT').toUpperCase();
  return KNOWN_ENVS.find(env => env === upper) ?? 'PRODUCTION';
}

/**
 * Returns the live `DesktopAccessDecision` for the current viewport + auth +
 * env + devMode. Re-renders on viewport resize and on devMode toggle.
 *
 * The decision is computed via the pure `resolveDesktopAccess()` policy so
 * the rules stay in one place and are unit-test friendly.
 */
export function useDesktopAccess(
  inputs: DesktopAccessInputs
): DesktopAccessDecision {
  // SSR-safe initial value: assume mobile so layout renders normally on the
  // server. Real value is computed in the effect below.
  const [viewportWidth, setViewportWidth] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const update = () => {
      setViewportWidth(window.innerWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
    };
  }, []);

  const isDevMode = useDevModeStore(s => s.isDevMode);
  const manualEnv = normalizeEnv(ENV_VARS.NEXT_PUBLIC_NODE_ENV_MANUAL);

  return resolveDesktopAccess({
    viewportWidth,
    manualEnv,
    isAdmin: inputs.isAdmin,
    isBecomeUser: inputs.isBecomeUser,
    isDevMode,
  });
}
