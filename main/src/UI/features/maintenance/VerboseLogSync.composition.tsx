// main/src/UI/features/maintenance/VerboseLogSync.composition.tsx
// Render-null controller: runs the app-wide VERBOSE_LOG_MODE → client-mirror sync
// (docs/LOGGING.md) via useVerboseLogSync. Mounted in _app.tsx alongside the other
// global controllers so it lives on EVERY page — including the layout-less /login,
// /welcome and /maintenance, where the MaintenanceBanner does not mount. Without
// this, info-level client logs would be silently dropped on a fresh-document login
// load even with VERBOSE_LOG_MODE on.

import { useVerboseLogSync } from './hooks/useMaintenanceMessage';

export function VerboseLogSyncComposition(): null {
  useVerboseLogSync();
  return null;
}
