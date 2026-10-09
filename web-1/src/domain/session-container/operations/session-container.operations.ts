/**
 * SessionContainer operations barrel (R8)
 *
 * Re-exports from split files:
 * - session-container-commands.operations.ts — create
 * - session-container-add-photo.operation.ts — addPhoto
 * - session-container-lifecycle.operations.ts — close, setNote
 * - session-container-share.operation.ts — share
 * - session-container-queries.operations.ts — getMy, getById, loadSessionDetail
 * - session-container-shared.operations.ts — mappers, helpers, constants
 */

// ─── Commands ─────────────────────────────────────────────────────────────
export { createSessionContainer_IO } from './session-container-commands.operations';
export { addPhotoToSessionContainer_IO } from './session-container-add-photo.operation';

// ─── Lifecycle (share + close + setNote) ──────────────────────────────────
export {
  shareSessionContainer_IO,
  closeSessionContainer_IO,
  setSessionContainerNote_IO,
} from './session-container-lifecycle.operations';

// ─── Queries ──────────────────────────────────────────────────────────────
export {
  getMySessionContainers_IO,
  getSessionContainerById_IO,
  loadSessionDetail_IO,
} from './session-container-queries.operations';
