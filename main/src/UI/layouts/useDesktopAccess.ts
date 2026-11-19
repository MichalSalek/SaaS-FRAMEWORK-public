import { useSyncExternalStore } from 'react';
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

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

const getViewportWidth = (): number => window.innerWidth;
const getServerViewportWidth = (): number => 0;

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
  // The viewport width comes from an external store: 0 on the server and while
  // React hydrates (the layout renders as on a phone and matches the server
  // HTML), the real width on every later render. A component that mounts after
  // hydration (a client navigation) gets the real width at once; with the old
  // `useState(0)` plus an effect it first rendered the phone decision and
  // swapped a frame later (DECISION in hooks/useHydrated.ts).
  const viewportWidth = useSyncExternalStore(
    subscribeToResize,
    getViewportWidth,
    getServerViewportWidth
  );

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
